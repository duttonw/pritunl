//# ==================================================================================================
//# Function: Asg to Route53 record domain update
//# Purpose:  Update domain with new list of public ip addresses of the asg
//# ==================================================================================================
var AWS=require("aws-sdk");

// MIT license (by Elan Shanker).
//https://objectpartners.com/2015/07/07/aws-tricks-updating-route53-dns-for-autoscalinggroup-using-lambda/
// with https://github.com/es128/async-waterfall/blob/master/index.js
'use strict';

var nextTick = function (fn) {
    if (typeof setImmediate === 'function') {
        setImmediate(fn);
    } else if (typeof process !== 'undefined' && process.nextTick) {
        process.nextTick(fn);
    } else {
        setTimeout(fn, 0);
    }
};

var makeIterator = function (tasks) {
    var makeCallback = function (index) {
        var fn = function () {
            if (tasks.length) {
                tasks[index].apply(null, arguments);
            }
            return fn.next();
        };
        fn.next = function () {
            return (index < tasks.length - 1) ? makeCallback(index + 1): null;
        };
        return fn;
    };
    return makeCallback(0);
};

var _isArray = Array.isArray || function(maybeArray){
    return Object.prototype.toString.call(maybeArray) === '[object Array]';
};

var waterfall = function (tasks, callback) {
    callback = callback || function () {};
    if (!_isArray(tasks)) {
        var err = new Error('First argument to waterfall must be an array of functions');
        return callback(err);
    }
    if (!tasks.length) {
        return callback();
    }
    var wrapIterator = function (iterator) {
        return function (err) {
            if (err) {
                callback.apply(null, arguments);
                callback = function () {};
            } else {
                var args = Array.prototype.slice.call(arguments, 1);
                var next = iterator.next();
                if (next) {
                    args.push(wrapIterator(next));
                } else {
                    args.push(callback);
                }
                nextTick(function () {
                    iterator.apply(null, args);
                });
            }
        };
    };
    wrapIterator(makeIterator(tasks))();
};

exports.handler = function (event, context) {
    console.log(event);
    var asg_msg = JSON.parse(event.Records[0].Sns.Message);
    var asg_name = asg_msg.AutoScalingGroupName;
    var instance_id = asg_msg.EC2InstanceId;
    var asg_event = asg_msg.Event;

    console.log(asg_event);
    if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH" || asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
        console.log("Handling Launch/Terminate Event for " + asg_name);
        var region = process.env.AWS_DEFAULT_REGION
        console.log(region)
        var autoscaling = new AWS.AutoScaling({region: region}); // ${AWS::Region}
        var ec2 = new AWS.EC2({region: region}); // ${AWS::Region}
        var route53 = new AWS.Route53();

        waterfall([
            function describeTags(next) {
                console.log("Describing ASG Tags");
                autoscaling.describeTags({
                    Filters: [
                        {
                            Name: "auto-scaling-group",
                            Values: [
                                asg_name
                            ]
                        },
                        {
                            Name: "key",
                            Values: ['DomainMeta']
                        }
                    ],
                    MaxRecords: 1
                }, next);
            },
            function processTags(response, next) {
                console.log("Processing ASG Tags");
                console.log(response.Tags);
                if (response.Tags.length == 0) {
                    next("ASG: " + asg_name + " does not define Route53 DomainMeta tag.");
                }
                var tokens = response.Tags[0].Value.split(':');
                var route53Tags = {
                    HostedZoneId: tokens[0],
                    RecordName: tokens[1]
                };
                console.log(route53Tags);
                next(null, route53Tags);
            },
            function retrieveASGInstances(route53Tags, next) {
                console.log("Retrieving Instances in ASG");
                autoscaling.describeAutoScalingGroups({
                    AutoScalingGroupNames: [asg_name],
                    MaxRecords: 1
                }, function(err, data) {
                    next(err, route53Tags, data);
                });
            },
            function retrieveInstanceIds(route53Tags, asgResponse, next) {
                console.log(asgResponse.AutoScalingGroups[0]);
                var instance_ids = asgResponse.AutoScalingGroups[0].Instances.map(function(instance) {
                    return instance.InstanceId
                });
                ec2.describeInstances({
                    DryRun: false,
                    InstanceIds: instance_ids
                }, function(err, data) {
                    next(err, route53Tags, data);
                });
            },
            function updateDNS(route53Tags, ec2Response, next) {
                console.log(ec2Response.Reservations);
                var resource_records = ec2Response.Reservations.map(function(reservation) {
                    return {
                        Value: reservation.Instances[0].NetworkInterfaces[0].Association.PublicIp
                    };
                });
                console.log(resource_records);
                route53.changeResourceRecordSets({
                    ChangeBatch: {
                        Changes: [
                            {
                                Action: 'UPSERT',
                                ResourceRecordSet: {
                                    Name: route53Tags.RecordName,
                                    Type: 'A',
                                    TTL: 10,
                                    ResourceRecords: resource_records
                                }
                            }
                        ]
                    },
                    HostedZoneId: route53Tags.HostedZoneId
                }, next);
            }
        ], function (err) {
            if (err) {
                console.error('Failed to process DNS updates for ASG event: ', err);
            } else {
                console.log("Successfully processed DNS updates for ASG event.");
            }
            context.done(err);
        })
    } else {
        console.log("Unsupported ASG event: " + asg_name, asg_event);
        context.done("Unsupported ASG event: " + asg_name, asg_event);
    }
};

== AWS quick install ==

Template : pritunl-db.cfn.yml

Prereq:
* Have a route53 zone created for pritunl to update.
* Install asgToRoute53Update.cfn.yml or use built-in updater (default)
* If you have a pre-exiting VPC with nat, then turn off public ip on mongodb

If you wanted Auth on mongodb the easy way. Use:
https://docs.aws.amazon.com/quickstart/latest/mongodb/welcome.html
https://github.com/aws-quickstart/quickstart-mongodb
Note: It won't allow you to stand up at t2/t3 instance. default is m4.large but you can choose from 1 instance or 3 in the replica group
Prama's to change:
* DatabaseEnabled: false
* MongoDBDomain: <ip or domain of your mongo db>

KeyName is not required, visit Systems Manage -> Session Manager to gain terminal access

If asg has more than 1 instance, the dns will be updated to include them well
If all instances are terminated the last ip will be left.
Lets Encrypt handles the SSL which requires port 80.    



Post install:
Internal mongodb can be configured with auth manually, the script should set the values for you (not tested yet)
this may help: https://github.com/aws-quickstart/quickstart-mongodb/blob/master/scripts/init_replica.sh#L142


Note: Network Load Balancers don't really work with openvpn if you want to use UDP. If that is ok, then wire up a NLB and forward the required ports out.

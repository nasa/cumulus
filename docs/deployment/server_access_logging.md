---
id: server_access_logging
title: S3 Server Access Logging
hide_title: true
---

# S3 Server Access Logging

To enable [EMS Reporting](../ems_reporting.md), you need to enable [S3 Server access logging][awslogging] on all protected buckets.


### Via AWS Console.

[Enable Server Access Logging for an S3 Bucket][howtologging]

### Via [AWS CLI][cli].


1. create a `logging.json` file with these contents, replacing `<stack-internal-bucket>` with your stack's internal bucket name, and `<stack>` with the name of your cumulus stack.
	```json
	{
		"LoggingEnabled": {
			"TargetBucket": "<stack-internal-bucket>",
			"TargetPrefix": "<stack>/ems-distribution/s3-server-access-logs/"
		}
	}
	```
2. Add the logging policy to your protected buckets by calling this command on each protected bucket.

	```sh
	aws s3api put-bucket-logging --bucket <protected-bucket-name> --bucket-logging-status file://logging.json
	```
3. Verify the logging policy exists on your protected buckets..
	```sh
	aws s3api get-bucket-logging --bucket <protected-bucket-name>
	```

[cli]: https://aws.amazon.com/cli/ "Amazon command line interface"
[howtologging]: https://docs.aws.amazon.com/AmazonS3/latest/user-guide/server-access-logging.html "Amazon Console Instructions"
[awslogging]: https://docs.aws.amazon.com/AmazonS3/latest/dev/ServerLogs.html "Amazon S3 Server Access Logging"

---
id: server_access_logging
title: S3 Server Access Logging
hide_title: true
---

# S3 Server Access Logging

**Note:** To support [EMS Reporting](../features/ems_reporting), you need to enable [Amazon S3 server access logging][awslogging] on all protected and public buckets.

## Via AWS Console

[Enable server access logging for an S3 bucket][howtologging]

## Via [AWS Command Line Interface][cli]

1. Create a `logging.json` file with these contents, replacing `<stack-internal-bucket>` with your stack's internal bucket name, and `<stack>` with the name of your cumulus stack.

    ```json
    {
      "LoggingEnabled": {
        "TargetBucket": "<stack-internal-bucket>",
        "TargetPrefix": "<stack>/ems-distribution/s3-server-access-logs/"
      }
    }
    ```

2. Add the logging policy to each of your protected and public buckets by calling this command on each bucket.

    ```sh
    aws s3api put-bucket-logging --bucket <protected/public-bucket-name> --bucket-logging-status file://logging.json
    ```

3. Verify the logging policy exists on your buckets.

    ```sh
    aws s3api get-bucket-logging --bucket <protected/public-bucket-name>
    ```

[cli]: https://aws.amazon.com/cli/ "Amazon command line interface"
[howtologging]: https://docs.aws.amazon.com/AmazonS3/latest/user-guide/server-access-logging.html "Amazon Console Instructions"
[awslogging]: https://docs.aws.amazon.com/AmazonS3/latest/dev/ServerLogs.html "Amazon S3 Server Access Logging"

---
id: version-v1.16.1-cloudwatch-retention
title: Cloudwatch Retention
hide_title: true
original_id: cloudwatch-retention
---

# Cloudwatch Retention

Our lambdas dump logs to [AWS CloudWatch](https://aws.amazon.com/cloudwatch/). By default, these logs exist indefinitely. However, there are ways to specify a duration for log retention.

## aws-cli

In addition to getting your aws-cli [set-up](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html), there are two values you'll need to acquire.

1. `log-group-name`: the name of the log group who's retention policy (retention time) you'd like to change. We'll use `/aws/lambda/KinesisInboundLogger` in our examples.
2. `retention-in-days`: the number of days you'd like to retain the logs in the specified log group for. There is a list of possible values available in the [aws logs documentation](https://docs.aws.amazon.com/cli/latest/reference/logs/put-retention-policy.html).

For example, if we wanted to set log retention to 30 days on our `KinesisInboundLogger` lambda, we would write:

```bash
aws logs put-retention-policy --log-group-name "/aws/lambda/KinesisInboundLogger" --retention-in-days 30
```

**Note:** The aws-cli log command that we're using is explained in detail [here](https://docs.aws.amazon.com/cli/latest/reference/logs/put-retention-policy.html).

## AWS Management Console

Changing the log retention policy in the AWS Management Console is a fairly simple process:

1. Navigate to the CloudWatch service in the AWS Management Console.
2. Click on the `Logs` entry on the sidebar.
3. Find the Log Group who's retention policy you're interested in changing.
4. Click on the value in the `Expire Events After` column.
5. Enter/Select the number of days you'd like to retain logs in that log group for.

![Screenshot of AWS console showing how to configure the retention period for Cloudwatch logs](assets/cloudwatch-retention.png)

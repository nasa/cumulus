---
id: cloudwatch-retention
title: Cloudwatch Retention
hide_title: false
---

Our lambdas dump logs to [AWS CloudWatch](https://aws.amazon.com/cloudwatch/). By default, these logs exist indefinitely. However, there are ways to specify a duration for log retention.

## aws-cli

In addition to getting your aws-cli [set-up](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html), there are two values you'll need to acquire.

1. `log-group-name`: the name of the log group who's retention policy (retention time) you'd like to change. We'll use `/aws/lambda/KinesisInboundLogger` in our examples.
2. `retention-in-days`: the number of days you'd like to retain the logs in the specified log group for. There is a list of possible values available in the [aws logs documentation](https://docs.aws.amazon.com/cli/latest/reference/logs/put-retention-policy.html).

For example, if we wanted to set log retention to 30 days on our `KinesisInboundLogger` lambda, we would write:

```bash
aws logs put-retention-policy --log-group-name "/aws/lambda/KinesisInboundLogger" --retention-in-days 30
```

:::note more about the aws-cli log command

The aws-cli log command that we're using is explained in detail [here](https://docs.aws.amazon.com/cli/latest/reference/logs/put-retention-policy.html).

:::

## AWS Management Console

Changing the log retention policy in the AWS Management Console is a fairly simple process:

1. Navigate to the CloudWatch service in the AWS Management Console.
2. Click on the `Logs` entry on the sidebar.
3. Find the Log Group who's retention policy you're interested in changing.
4. Click on the value in the `Expire Events After` column.
5. Enter/Select the number of days you'd like to retain logs in that log group for.

![Screenshot of AWS console showing how to configure the retention period for Cloudwatch logs](../assets/cloudwatch-retention.png)

## Terraform

The `cumulus` module exposes values for configuration of log retention for
cloudwatch log groups (in days). A configurable map of `cloudwatch_log_retention_periods` currently supports the following variables:

- cumulus-tf_egress_lambda_log_retention
- archive_private_api_log_retention
- archive_api_log_retention
- archive_async_operation_log_retention
- archive_granule_files_cache_updater_log_retention
- archive_publish_executions_log_retention
- archive_publish_granule_log_retention
- archive_publish_pdrs_log_retention
- archive_replay_sqs_messages_log_retention
- cumulus_distribution_api_log_retention
- cumulus_ecs_service_default_log_retention
- ingest_discover_pdrs_task_log_retention
- ingest_hyrax_metadata_updates_task_log_retention
- ingest_parse_pdr_task_log_retention
- ingest_post_to_cmr_task_log_retention
- ingest_queue_pdrs_task_log_retention
- ingest_queue_workflow_task_log_retention
- ingest_sync_granule_task_log_retention
- ingest_update_cmr_access_constraints_task_log_retention

In order to configure this value for the cloudwatch log group, the variable for the retention period for the respective group should be in the form of:

```hcl
<cumulus_module>_<cloudwatch_log_group>_log_retention: <log_retention>
  type = number
```

An example, in the case of configuring the retention period for the `parse_pdr_task` `aws_cloudwatch_log_group`:

### Example

```tf
cloudwatch_log_retention_periods = {
  ingest_parse_pdr_task_log_retention = 365
}
```

Additionally, the variable `default_log_retention_days` can be configured separately during deployment in order to set the default log retention for the cloudwatch log groups in case a custom value isn't used. The log groups will use this value for their retention value, and if this value is not set either, the retention will default to 30 days.

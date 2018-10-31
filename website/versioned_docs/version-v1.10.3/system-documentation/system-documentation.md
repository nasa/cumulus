---
id: version-v1.10.3-system-documentation
title: Troubleshooting Cumulus
hide_title: true
original_id: system-documentation
---

# How to Troubleshoot and Fix Issues

While Cumulus is a complex system, there is a focus on maintaining the integrity and availability of the system and data. Should you encounter errors or issues while using this system, this section will help troubleshoot and solve those issues.

## Backup and Restore

Cumulus has backup and restore functionality built-in to protect Cumulus data and allow recovery of a Cumulus stack. This is currently limited to Cumulus data and not full S3 archive data. Backup and restore is not enabled by default and must be enabled and configured to take advantage of this feature.

For more information, read the [Backup and Restore documentation](data_in_dynamodb.md#backup-and-restore-with-aws).

## Elasticsearch reindexing

If new Elasticsearch mappings are added to Cumulus, they are automatically added to the index upon deploy. If you run into issues with your Elasticsearch index, a reindex operation is available via a command-line tool in the Cumulus API.

Information on how to reindex Elasticsearch is in the [Cumulus API package documentation](https://www.npmjs.com/package/@cumulus/api#reindexing-elasticsearch-indices).

## Troubleshooting Workflows

Workflows are state machines comprised of tasks and services and each component logs to [CloudWatch](https://aws.amazon.com/cloudwatch). The CloudWatch logs for all steps in the execution are displayed in the Cumulus dashboard or you can find them by going to CloudWatch and navigating to the logs for that particular task.

### Workflow Errors

Visual representations of executed workflows can be found in the Cumulus dashboard or the AWS Step Functions console for that particular execution.

If a workflow errors, the error will be handled according to the [error handling configuration](data-cookbooks/error-handling.md). The task that fails will have the `exception` field populated in the output, giving information about the error. Further information can be found in the CloudWatch logs for the task.

![](assets/workflow-fail.png)

### Workflow Did Not Start

Generally, first check your rule configuration. If that is satisfactory, the answer will likely be in the CloudWatch logs for the schedule SF or SF starter lambda functions. See the [workflow triggers](workflows/workflow-triggers.md) page for more information on how workflows start.

For Kinesis rules specifically, if an error occurs during the kinesis consumer process, the fallback consumer lambda will be called and if the message continues to error, a message will be placed on the dead letter queue. Check the dead letter queue for a failure message. Errors can be traced back to the CloudWatch logs for the kinesis consumer and the fallback consumer.

More information on kinesis error handling is [here](data-cookbooks/cnm-workflow.md#kinesis-record-error-handling).

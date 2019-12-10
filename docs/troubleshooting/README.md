---
id: troubleshooting-readme
title: Troubleshooting Cumulus
hide_title: true
---

# How to Troubleshoot and Fix Issues

While Cumulus is a complex system, there is a focus on maintaining the integrity and availability of the system and data. Should you encounter errors or issues while using this system, this section will help troubleshoot and solve those issues.

## Backup and Restore

Cumulus has backup and restore functionality built-in to protect Cumulus data and allow recovery of a Cumulus stack. This is currently limited to Cumulus data and not full S3 archive data. Backup and restore is not enabled by default and must be enabled and configured to take advantage of this feature.

For more information, read the [Backup and Restore documentation](features/data_in_dynamodb.md#backup-and-restore-with-aws).

## Elasticsearch reindexing

If new Elasticsearch mappings are added to Cumulus, they are automatically added to the index upon deploy. If you run into issues with your Elasticsearch index, a reindex operation is available via the Cumulus API.

Information on how to reindex Elasticsearch is in the [Cumulus API  documentation](https://nasa.github.io/cumulus-api/#elasticsearch-1).

## Troubleshooting Workflows

Workflows are state machines comprised of tasks and services and each component logs to [CloudWatch](https://aws.amazon.com/cloudwatch). The CloudWatch logs for all steps in the execution are displayed in the Cumulus dashboard or you can find them by going to CloudWatch and navigating to the logs for that particular task.

### Workflow Errors

Visual representations of executed workflows can be found in the Cumulus dashboard or the AWS Step Functions console for that particular execution.

If a workflow errors, the error will be handled according to the [error handling configuration](data-cookbooks/error-handling.md). The task that fails will have the `exception` field populated in the output, giving information about the error. Further information can be found in the CloudWatch logs for the task.

![Graph of AWS Step Function execution showing a failing workflow](assets/workflow-fail.png)

### Workflow Did Not Start

Generally, first check your rule configuration. If that is satisfactory, the answer will likely be in the CloudWatch logs for the schedule SF or SF starter lambda functions. See the [workflow triggers](workflows/workflow-triggers.md) page for more information on how workflows start.

For Kinesis rules specifically, if an error occurs during the message consumer process, the fallback consumer lambda will be called and if the message continues to error, a message will be placed on the dead letter queue. Check the dead letter queue for a failure message. Errors can be traced back to the CloudWatch logs for the message consumer and the fallback consumer.

More information on kinesis error handling is [here](data-cookbooks/cnm-workflow.md#kinesis-record-error-handling).

## Operator API Errors

All operator API calls are funneled through the `ApiEndpoints` lambda. Each API call is logged to the `ApiEndpoints` CloudWatch log for your deployment.

## Lambda Errors

### KMS Exception: AccessDeniedException

`KMS Exception: AccessDeniedExceptionKMS Message: The ciphertext refers to a customer master key that does not exist, does not exist in this region, or you are not allowed to access.`

The above error was being thrown by cumulus lambda function invocation. The KMS key is the encryption key used to encrypt lambda environment variables. The root cause of this error is unknown, but is speculated to be caused by deleting and recreating, with the same name, the IAM role the lambda uses.

This error can be resolved by switching the lambda's execution role to a different one and then back through the Lambda management console. Unfortunately, this approach doesn't scale well.

The other resolution (that scales but takes some time) that was found is as follows:

1. Comment out all lambda definitions (and dependent resources) in your Terraform configuration.
2. `terraform apply` to delete the lambdas.
3. Un-comment the definitions.
4. `terraform apply` to recreate the lambdas.

If this problem occurs with Core lambdas and you are using the `terraform-aws-cumulus.zip` file source distributed in our release, we recommend using the non-scaling approach as the number of lambdas we distribute is in the low teens, which are likely to be easier and faster to reconfigure one-by-one compared to editing our configs.

### Error: Unable to import module 'index': Error

This error is shown in the CloudWatch logs for a Lambda function.

One possible cause is that the Lambda definition in the `.tf` file defining the lambda is not pointing to the correct packaged lambda source file. In order to resolve this issue, update the lambda definition to point directly to the packaged (e.g. `.zip`) lambda source file.

```hcl
resource "aws_lambda_function" "discover_granules_task" {
  function_name    = "${var.prefix}-DiscoverGranules"
  filename         = "${path.module}/../../tasks/discover-granules/dist/lambda.zip"
  handler          = "index.handler"
}
```

If you are seeing this error when using the Lambda as a step in a Cumulus workflow, then inspect the output for this Lambda step in the AWS Step Function console. If you see the error `Cannot find module 'node_modules/@cumulus/cumulus-message-adapter-js'`, then you need to ensure the lambda's packaged dependencies include `cumulus-message-adapter-js`.

---
id: ingest-notifications
title: Ingest Notification in Workflows
hide_title: true
---

# Ingest Notification in Workflows

On deployment, an [SQS queue](https://aws.amazon.com/sqs/) and three [SNS topics](https://aws.amazon.com/sns/) are created and used for handling notification messages related to the workflow.

The `sfEventSqsToDbRecords` Lambda function reads from the `sfEventSqsToDbRecordsInputQueue` queue and updates DynamoDB. The DynamoDB events for the `ExecutionsTable`, `GranulesTable` and `PdrsTable` are streamed on DynamoDBStreams, which are read by the `publishExecutions`, `publishGranules` and `publishPdrs` Lambda functions, respectively.

These Lambda functions publish to the three SNS topics both when the workflow starts and when it reaches a terminal state (completion or failure). The following describes how many message(s) each topic receives **both on workflow start and workflow completion/failure**:

- `reportExecutions` - Receives 1 message per workflow execution
- `reportGranules` - Receives 1 message per granule in a workflow execution
- `reportPdrs` - Receives 1 message per PDR

![Diagram of architecture for reporting workflow ingest notifications from AWS Step Functions](assets/interfaces.svg)

The ingest notification reporting SQS queue is populated via a [Cloudwatch rule for any Step Function execution state transitions](https://docs.aws.amazon.com/step-functions/latest/dg/cw-events.html). The `sfEventSqsToDbRecords` Lambda consumes this queue. The queue and Lambda are included in the `cumulus` module and the Cloudwatch rule in the `workflow` module and are included by default in a Cumulus deployment.

## Sending SQS messages to report status

### Publishing granule/PDR reports directly to the SQS queue

If you have a non-Cumulus workflow or process ingesting data and would like to update the status of your granules or PDRs, you can publish directly to the reporting SQS queue. Publishing messages to this queue will result in those messages being stored as granule/PDR records in the Cumulus database and having the status of those granules/PDRs being visible on the Cumulus dashboard. The queue does have certain expectations as it expects a Cumulus Message nested within a Cloudwatch Step Function Event object.

Posting directly to the queue will require knowing the queue URL. Assuming that you are using the [`cumulus` module](https://github.com/nasa/cumulus/blob/master/tf-modules/cumulus) for your deployment, you can get the queue URL by adding them to `outputs.tf` for your Terraform deployment [as in our example deployment](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/outputs.tf):

```hcl
output "stepfunction_event_reporter_queue_url" {
  value = module.cumulus.stepfunction_event_reporter_queue_url
}

output "report_executions_sns_topic_arn" {
  value = module.cumulus.report_executions_sns_topic_arn
}
output "report_granules_sns_topic_arn" {
  value = module.cumulus.report_executions_sns_topic_arn
}
output "report_pdrs_sns_topic_arn" {
  value = module.cumulus.report_pdrs_sns_topic_arn
}
```

Then, when you run `terraform deploy`, you should see the topic ARNs printed to your console:

```bash
Outputs:
...
stepfunction_event_reporter_queue_url = https://sqs.us-east-1.amazonaws.com/xxxxxxxxx/<prefix>-sfEventSqsToDbRecordsInputQueue
report_executions_sns_topic_arn = arn:aws:sns:us-east-1:xxxxxxxxx:<prefix>-report-executions-topic
report_granules_sns_topic_arn = arn:aws:sns:us-east-1:xxxxxxxxx:<prefix>-report-executions-topic
report_pdrs_sns_topic_arn = arn:aws:sns:us-east-1:xxxxxxxxx:<prefix>-report-pdrs-topic
```

Once you have the queue URL, you can use the AWS SDK for your language of choice to publish messages to the topic. The expected format of these messages is that of a [Cloudwatch Step Function event](https://docs.aws.amazon.com/step-functions/latest/dg/cw-events.html) containing a Cumulus message. For `SUCCEEDED` events, the Cumulus message is expected to be in `detail.output`. For all other events statuses, a Cumulus Message is expected in `detail.input`. The Cumulus Message populating these fields **MUST** be a JSON string, not an object. **Messages that do not conform to the schemas will fail to be created as records**.

If you are not seeing records persist to the database or show up in the Cumulus dashboard, you can investigate the Cloudwatch logs of the SQS consumer Lambda:

- `/aws/lambda/<prefix>-sfEventSqsToDbRecords`

### In a workflow

As described above, ingest notifications will automatically be published to the SNS topics on workflow start and completion/failure, so **you should not include a workflow step to publish the initial or final status of your workflows**.

However, if you want to report your ingest status at any point **during a workflow execution**, you can add a workflow step using the `SfSqsReport` Lambda. In the following example from [`cumulus-tf/pase_pdr_workflow.tf`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/parse_pdr_workflow.tf), the `ParsePdr` workflow is configured to use the `SfSqsReport` Lambda, primarily to update the PDR ingestion status.

```json
  "PdrStatusReport": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "ReplaceConfig": {
          "FullMessage": true
        },
        "task_config": {
          "cumulus_message": {
            "input": "{$}"
          }
        }
      }
    },
    "ResultPath": null,
    "Type": "Task",
    "Resource": "${module.cumulus.sf_sqs_report_task.task_arn}",
    "Retry": [
      {
        "ErrorEquals": [
          "Lambda.ServiceException",
          "Lambda.AWSLambdaException",
          "Lambda.SdkClientException"
        ],
        "IntervalSeconds": 2,
        "MaxAttempts": 6,
        "BackoffRate": 2
      }
    ],
    "Catch": [
      {
        "ErrorEquals": [
          "States.ALL"
        ],
        "ResultPath": "$.exception",
        "Next": "WorkflowFailed"
      }
    ],
    "Next": "WaitForSomeTime"
  },
```

## Subscribing additional listeners to SNS topics

Additional listeners to SNS topics can be configured in a `.tf` file for your Cumulus deployment. Shown below is configuration that subscribes an additional Lambda function (`test_lambda`) to receive messages from the `report_executions` SNS topic. To subscribe to the `report_granules` or `report_pdrs` SNS topics instead, simply replace `report_executions` in the code block below with either of those values.

```hcl
resource "aws_lambda_function" "test_lambda" {
  function_name    = "${var.prefix}-testLambda"
  filename         = "./testLambda.zip"
  source_code_hash = filebase64sha256("./testLambda.zip")
  handler          = "index.handler"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs10.x"
}

resource "aws_sns_topic_subscription" "test_lambda" {
  topic_arn = module.cumulus.report_executions_sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.test_lambda.arn
}

resource "aws_lambda_permission" "test_lambda" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.test_lambda.arn
  principal     = "sns.amazonaws.com"
  source_arn    = module.cumulus.report_executions_sns_topic_arn
}
```

### SNS message format

Subscribers to the SNS topics can expect to find the published message in the [SNS event](https://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-sns) at `Records[0].Sns.Message`. The message will be a JSON stringified version of the ingest notification record for an execution, a granule, or a PDR.

The record parsed from the JSON stringified version of the execution, granule, or PDR should conform to the [data model schema for the given record type](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js).

## Summary

Workflows can be configured to send SQS messages at any point using the `sf-sqs-report` task.

Additional listeners can be easily configured to trigger when messages are sent to the SNS topics.

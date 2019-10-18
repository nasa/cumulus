---
id: sns
title: SNS Notification in Workflows
hide_title: true
---

# SNS Notification in Workflows

On deployment, three [SNS topics](https://aws.amazon.com/sns) are created and used for handling notification messages related to the workflow. The `publishReports` Lambda publishes to these topics both when the workflow starts and when it reaches a terminal state (completion or failure). The following describes how many message(s) each topic receives **both on workflow start and workflow completion/failure**:

- `reportExecutions` - Receives 1 message per workflow execution
- `reportGranules` - Receives 1 message per granule in a workflow execution
- `reportPdrs` - Receives 1 message per PDR

![Diagram of architecture for reporting workflow ingest notifications from AWS Step Functions](assets/workflow_reporting_diagram.png)

The `publishReports` Lambda is triggered via a [Cloudwatch rule for any Step Function execution state transitions](https://docs.aws.amazon.com/step-functions/latest/dg/cw-events.html). Both the `publishReports` Lambda and Cloudwatch rule and are included by default in a Cumulus deployment.

More information on configuring an SNS topic or subscription in Cumulus can be found in our [developer documentation](../deployment/config_descriptions#sns).

## Sending SNS messages to report status

### Publishing granule/PDR reports directly to SNS topics

If you have a non-Cumulus workflow or process ingesting data and would like to update the status of your granules or PDRs, you can publish directly to those SNS topics. Publishing messages to those topics will result in those messages being stored as granule/PDR records in the Cumulus database and having the status of those granules/PDRs being visible on the Cumulus dashboard.

Posting directly to the topics will require knowing their ARNs. Assuming that you are using the [`cumulus` module](https://github.com/nasa/cumulus/blob/master/tf-modules/cumulus) for your deployment, you can get the topic ARNs by adding them to `outputs.tf` for your Terraform deployment [as in our example deployment](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/outputs.tf):

```HCL
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
report_executions_sns_topic_arn = arn:aws:sns:us-east-1:000000000:<prefix>-report-executions-topic
report_granules_sns_topic_arn = arn:aws:sns:us-east-1:000000000:<prefix>-report-executions-topic
report_pdrs_sns_topic_arn = arn:aws:sns:us-east-1:000000000:<prefix>-report-pdrs-topic
```

Once you have the topic ARN, you can use the AWS SDK for your language of choice to publish messages to the topic. The expected format of granule and PDR records can be found in the [data model schemas](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js). **Messages that do not conform to the schemas will fail to be created as records**.

If you are not seeing records persist to the database or show up in the Cumulus dashboard, you can investigate the Cloudwatch logs of the SNS topic consumer Lambas:

- `<prefix>-reportPdrs`
- `<prefix>-reportGranules`

### In a workflow

As described above, ingest notifications will automatically be published to the SNS topics on workflow start and completion/failure, so **you should not include a workflow step to publish the initial or final status of your workflows**.

However, if you want to report your ingest status at any point **during a workflow execution**, you can add a workflow step using the `SfSnsReport` Lambda. In the following example from [`cumulus-tf/pase_pdr_workflow.tf`](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/parse_pdr_workflow.tf), the `ParsePdr` workflow is configured to use the `SfnSnsReport` Lambda, primarily to update the PDR ingestion status.

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
    "Resource": "${module.cumulus.sf_sns_report_task_lambda_function_arn}",
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

Additional listeners to SNS topics can be configured in `app/config.yml`. Shown below is configuration that subscribes an additional Lambda function (`SnsS3Test`) to receive messages from the `reportExecutions` SNS topic. To subscribe to the `reportGranules` or `reportPdrs` SNS topics instead, simply replace `reportExecutions` in the code block below with either of those topic names.

```yaml
sns:
  reportExecutions:
    subscriptions:
      additionalReceiver:                 # name of the new subscription.
        endpoint:
          function: Fn::GetAtt
          array:
            - SnsS3TestLambdaFunction     # a lambda configured in lambdas.yml
            - Arn
        protocol: lambda
```

Make sure that the subscriber Lambda is configured in `lambdas.yml`. **Note that the Lambda name configured in `lambdas.yml`,`SnsS3Test`, needs to have its name postpended with `LambdaFunction` (as in the example above) to have the ARN correctly found.**

More information on configuring an SNS topic subscriptions in Cumulus can be found in our [developer documentation](../deployment/config_descriptions#sns).

### SNS message format

Subscribers to the SNS topics can expect to find the published message in the [SNS event](https://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-sns) at `Records[0].Sns.Message`. The message will be a JSON stringified version of the ingest notification record for an execution, a granule, or a PDR.

The record parsed from the JSON stringified version of the execution, granule, or PDR should conform to the [data model schema for the given record type](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js).

## Summary

The workflows can be configured to send SNS messages at any point. Additional listeners can be easily configured to trigger when messages are sent to the SNS topics.

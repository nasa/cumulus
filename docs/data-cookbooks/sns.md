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

## Sending an SNS message to report status

SNS messages can be sent at anytime during the workflow execution by adding a workflow step to send the message using the `publishReports` Lambda. In the following example, a PDR status report step is configured to report PDR status. This is configured in `workflows/sips.yml`.

```yaml
PdrStatusReport:
  CumulusConfig:
    cumulus_message:
      input: '{$}'
  ResultPath: null
  Type: Task
  Resource: ${publishReportsLambdaFunction.Arn}
```

### Subscribing Additional Listeners

Additional listeners to SNS topics can be configured in `app/config.yml`. Shown below is configuration that subscribes an additional lambda function (`SnsS3Test`) to receive broadcasts from the `reportExecutions` SNS topic. The `endpoint` value depends on the protocol, which for a Lambda function requires the function's ARN. In the configuration it is populated by finding the lambda's ARN attribute via [Fn::GetAtt](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-getatt.html). Note the lambda name configured in `lambdas.yml` `SnsS3Test` needs to have it's name postpended with `LambdaFunction` to have the ARN correctly found.

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

Make sure that the receiver Lambda is configured in `lambdas.yml`.

### SNS message format

Subscribers to the SNS Topics can expect to find the published messages by parsing the JSON string representation of the message found in the [SNS event](https://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-sns) at `Records[].Sns.Message` . The value found at `Records[0].Sns.Message` will be a stringified version of the ingest notification record to be saved for an execution, granule, or PDR.

## Summary

The workflows can be configured to send SNS messages at any point. Additional listeners can be easily configured to trigger when messages are sent to the SNS topics.

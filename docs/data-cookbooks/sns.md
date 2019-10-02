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

### Publishing directly to SNS topics

If you have a non-Cumulus workflow or process ingesting data and would like to update the status of your granules or PDRs, you can post directly to those SNS topics. Posting to these topics will result in Cumulus having a record of these ingestions and these ingestion process being visible on the Cumulus dashboard.

Posting directly to the topics will require knowing their ARNs, which can be found in the AWS Console by going to Cloudformation > Stacks > `<your_stack_name>` > Resources and then finding `reportGranulesSns` or `reportPdrsSns` in the list of resources.

### In a workflow

SNS messages can be sent at anytime during the workflow execution by adding a workflow step to send the messages. In the following example, a PDR status report step is configured to report PDR status. This is configured in [`workflows/sips.yml`](https://github.com/nasa/cumulus/blob/master/example/workflows/sips.yml).

```yaml
PdrStatusReport:
  CumulusConfig:
    cumulus_message:
      input: '{$}'
  ResultPath: null
  Type: Task
  Resource: ${SfSnsReportLambdaFunction.Arn}
```

### Task Configuration

To use the `SfSnsReport` Lambda, the following configuration should be added to `lambas.yml`:

```yaml
SfSnsReport:
  handler: index.handler
  timeout: 300
  source: 'node_modules/@cumulus/sf-sns-report/dist'
  useMessageAdapter: true
```

## Subscribing additional listeners to SNS topics

Additional listeners to SNS topics can be configured in `app/config.yml`. Shown below is configuration that subscribes an additional Lambda function (`SnsS3Test`) to receive messages from the `reportExecutions` SNS topic. To subscribe to the `reportGranules` or `reportPdrs` SNS topics instead, simply replace `reportExecutions` in the code block below with either of those topic names.

The `endpoint` value depends on the protocol, which for a Lambda function requires the function's ARN. In the configuration it is populated by finding the Lambda's ARN via [Fn::GetAtt](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-getatt.html). Note the lambda name configured in `lambdas.yml` `SnsS3Test` needs to have it's name postpended with `LambdaFunction` to have the ARN correctly found.

```yaml
sns:
  reportExecutionsSubscription:
    arn:
      Fn::GetAtt:
        - reportExecutions
        - Arn
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

The `SfSnsReport` lambda receives the Cumulus message [(as the lambda's task input)](../workflows/input_output.html#2-resolve-task-input) and is responsible for publishing the message to the sftracker SNS Topic. But before it publishes the message, `SfSnsReport` makes a determiniation about the workflow status and adds an additional metadata key to the message at `message.meta.status`.

First it determines whether the workflow has finished by looking for the `sfnEnd` key in the `config` object. If the workflow has finished, it checks to see if it has failed by searching the input message for a non-empty `exception` object. The lambda updates the `message.meta.status` with `failed` or `completed` based on that result. If the workflow is not finished the lambda sets `message.meta.status` to `running`.

This means that subscribers to the sftracker SNS Topic can expect to find the published message by parsing the JSON string representation of the message found in the [SNS event](https://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-sns) at `Records[].Sns.Message` and examining the `meta.status` value.  The value found at `Records[0].Sns.Message` will be a stringified version of the workflow's Cumulus message with the status metadata attached.

## Summary

The workflows can be configured to send SNS messages at any point. Additional listeners can be easily configured to trigger when messages are sent to the SNS topics.

---
id: sns
title: SNS Notification in Workflows
hide_title: true
---

# SNS Notification in Workflows

On deployment, an sftracker (Step function tracker) [SNS](https://aws.amazon.com/sns) topic is created and used for messages related to the workflow.

Workflows can be configured to send SNS messages containing the Cumulus message throughout the workflow by using the [SF-SNS-Report lambda function](https://www.npmjs.com/package/@cumulus/sf-sns-report).

More information on configuring an SNS topic or subscription in Cumulus can be found in our [developer documentation](../deployment/config_descriptions#sns).

## Pre-Deployment Configuration

### Workflow Configuration

The [Hello World Workflow](data-cookbooks/hello-world.md) is configured to send an SNS message when starting the workflow and upon workflow completion. This is configured in `workflows/helloworld.yml`.

```yaml
HelloWorldWorkflow:
  Comment: 'Returns Hello World'
  StartAt: StartStatus
  States:
    StartStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn} # This will send a status message at the start of the workflow
      CumulusConfig:
        cumulus_message:
          input: '{$}' # Configuration to send the payload to the SNS Topic
      Next: HelloWorld
    HelloWorld:
      CumulusConfig:
        buckets: '{$.meta.buckets}'
        provider: '{$.meta.provider}'
        collection: '{$.meta.collection}'
      Type: Task
      Resource: ${HelloWorldLambdaFunction.Arn}
      Next: StopStatus
    StopStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn} # This will send a success status message at the end of the workflow
      CumulusConfig:
        sfnEnd: true # Indicates the end of the workflow
        stack: '{$.meta.stack}'
        bucket: '{$.meta.buckets.internal.name}'
        stateMachine: '{$.cumulus_meta.state_machine}'
        executionName: '{$.cumulus_meta.execution_name}'
        cumulus_message:
          input: '{$}' # Configuration to send the payload to the SNS Topic
      Catch:
        - ErrorEquals:
          - States.ALL
          Next: WorkflowFailed
      End: true
    WorkflowFailed:
      Type: Fail
      Cause: 'Workflow failed'
```

#### Sending an SNS Message in an Error Case

To send an SNS message for an error case, you can configure your workflow to catch errors and set the next workflow step on error to a step with the `SfSnsReportLambdaFunction` lambda function. This is configured in `workflows/sips.yml`.

```yaml
DiscoverPdrs:
  CumulusConfig:
    stack: '{$.meta.stack}'
    provider: '{$.meta.provider}'
    bucket: '{$.meta.buckets.internal.name}'
    collection: '{$.meta.collection}'
  Type: Task
  Resource: ${DiscoverPdrsLambdaFunction.Arn}
  Catch:
    - ErrorEquals:
      - States.ALL
      ResultPath: '$.exception'
      Next: StopStatus # On error, run the StopStatus step which calls the SfSnsReportLambdaFunction
  Next: QueuePdrs # When no error, go to the next step in the workflow
```

#### Sending an SNS message to report status

SNS messages can be sent at anytime during the workflow execution by adding a workflow step to send the message. In the following example, a PDR status report step is configured to report PDR status. This is configured in `workflows/sips.yml`.

```yaml
PdrStatusReport:
  CumulusConfig:
    cumulus_message:
      input: '{$}'
  ResultPath: null
  Type: Task
  Resource: ${SfSnsReportLambdaFunction.Arn}
  Next: StopStatus
```

### Task Configuration

To use the SfSnsReport lambda, the following configuration should be added to `lambas.yml`:

```yaml
SfSnsReport:
  handler: index.handler
  timeout: 300
  source: 'node_modules/@cumulus/sf-sns-report/dist'
  useMessageAdapter: true
```

### Subscribing Additional Listeners

Additional listeners to the SF tracker topic can be configured in `app/config.yml` under `sns.sftracker.subscriptions`. Shown below is configuration that subscribes an additional lambda function (`SnsS3Test`) to receive broadcasts from the `sftracker` SNS. The `endpoint` value depends on the protocol, and for a  lambda function, requres the function's Arn. In the configuration it is populated by finding the lambda's Arn attribute via [Fn::GetAtt](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-getatt.html). Note the lambda name configured in `lambdas.yml` `SnsS3Test` needs to have it's name postpended with `LambdaFunction` to have the Arn correctly found.

```yaml
sns:
  sftracker:
    subscriptions:
      additionalReceiver:                 # name of the new subscription.
        endpoint:
          function: Fn::GetAtt
          array:
            - SnsS3TestLambdaFunction     # a lambda configured in lambdas.yml
            - Arn
        protocol: lambda
```

Make sure that the receiver lambda is configured in `lambdas.yml`.

### SNS message format

The configured `SfSnsReport` lambda receives the Cumulus message [(as the lambda's task input)](../workflows/input_output.html#2-resolve-task-input) and is responsible for publishing the message to the sftracker SNS Topic. But before it publishes the message, `SfSnsReport` makes a determiniation about the workflow status and adds an additional metadata key to the message at `message.meta.status`.

First it determines whether the workflow has finished by looking for the `sfnEnd` key in the `config` object.  If the workflow has finished, it checks to see if it has failed by searching the input message for a non-empty `exception` object. The lambda updates the `message.meta.status` with `failed` or `completed` based on that result.  If the workflow is not finished the lambda sets `message.meta.status` to `running`.

This means that subscribers to the sftracker SNS Topic can expect to find the published message by parsing the JSON string representation of the message found in the [SNS event](https://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-sns) at `Records[].Sns.Message` and examining the `meta.status` value.  The value found at `Records[0].Sns.Message` will be a stringified version of the workflow's Cumulus message with the status metadata attached.



## Summary

The workflows can be configured to send SNS messages at any point. Additional listeners can be easily configured to trigger when a message is sent to the SNS topic.

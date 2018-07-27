# SNS Notifications in Workflows

On deployment, an sftracker (Step function tracker) [SNS](https://aws.amazon.com/sns) topic is created and used for messages related to the workflow.

Workflows can be configured to send SNS messages containing the Cumulus message throughout the workflow by using the [SF SNS Report lambda function](https://www.npmjs.com/package/@cumulus/sf-sns-report).

## Pre-Deployment Configuration

### Workflow Configuration

The [Hello World Workflow](./hello-world.md) is configured to send an SNS message when starting the workflow and upon workflow completion. This is configured in `workflows.yml`.

```
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

To send an SNS message for an error case, you can configure your workflow to catch errors and set the next workflow step on error to a step with the `SfSnsReportLambdaFunction` lambda function. This is configured in `workflows.yml`.

```
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
      Next: StopStatus # On error, call the SfSnsReportLambdaFunction
  Next: QueuePdrs # When no error, go to the next step in the workflow
```

#### Sending an SNS message to report status

SNS messages can be sent at anytime during the workflow execution by adding a workflow step to send the message. In the following example, a PDR status report step is configured to report PDR status. This is configured in `workflows.yml`.

```
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

```
SfSnsReport:
  handler: index.handler
  timeout: 300
  source: 'node_modules/@cumulus/sf-sns-report/dist'
  useMessageAdapter: true 
```

### Subscribing Additional Listeners

Additional listeners to the SF tracker topic can be configured in `app/config.yml` under `sns:`.

```
sns:
  sftracker:
    subscriptions:
      additionalListener: # Give this a name here
        endpoint:
          function: Fn::GetAtt
          array:
            - SnsS3TestLambdaFunction # Configured in lambdas.yml
            - Arn
        protocol: lambda
```

Make sure that your listener lambda is configured in `lambdas.yml`.

## Summary

The workflows can be configured to send SNS messages at any point. Additional listeners can be easily configured to trigger when a message is sent to the SNS topic.

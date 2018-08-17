### Retry Configuration
In the RetryPassWorkflow, the HelloWorld step has an attribute labeled `Retry`. Valid json configuration of this attribute for workflows is explained in the AWS documentation. Cumulus deployment (kes) requires configuration to be written in (or translated to) `.yml` format, but required attributes and their functions are the same.

```
RetryPassWorkflow:
  Comment: 'Tests Retry Configurations'
  StartAt: StartStatus
  States:
    StartStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
      CumulusConfig:
        cumulus_message:
          input: '{$}'
      Next: HelloWorld
    HelloWorld:
      CumulusConfig:
        fail: true
        passOnRetry: true
      Type: Task
      Resource: ${HelloWorldLambdaFunction.Arn}
      Next: StopStatus
      Retry:
          - ErrorEquals:
              - States.ALL
            IntervalSeconds: 2
            MaxAttempts: 3
    StopStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
      CumulusConfig:
        sfnEnd: true
        stack: '{$.meta.stack}'
        bucket: '{$.meta.buckets.internal.name}'
        stateMachine: '{$.cumulus_meta.state_machine}'
        executionName: '{$.cumulus_meta.execution_name}'
        cumulus_message:
          input: '{$}'
      Catch:
        - ErrorEquals:
          - States.ALL
          Next: WorkflowFailed
      End: true
    WorkflowFailed:
      Type: Fail
      Cause: 'Workflow failed'
```


---
id: version-1.15.0-error-handling
title: Error Handling in Workflows
hide_title: true
original_id: error-handling
---

# Error Handling in Workflows

Cumulus Workflow error handling is configurable via Cumulus Workflow Definitions. These workflow definitions are AWS Step Function definitions, and AWS Step Functions enable users to configure what the state machine does next when an exception is thrown. Read more in the AWS docs: [How Step Functions Works: Error Handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html).

Cumulus Workflow Tasks _should_ throw errors and rely on the state machine logic to handle the error state. Errors and exceptions thrown in Cumulus Workflow Tasks using the Cumulus Message Adapter (CMA) are caught and rethrown by the CMA libraries _unless_ the error name contains `WorkflowError`.

The former (tasks which throw errors which are not `WorkflowError`s) is the expected behavior. However a `WorkflowError` can be used to handle errors that should _not_ result in task failure.

## Workflow Configuration

Some best practices for error handling in Cumulus Workflows are:

* States should include a `Catch` configuration object which defines the `ResultPath` to be `$.exception`. This passes along the entire Cumulus message to the next state with the addition of the `Error` and `Cause` details of the thrown error in the `exception` key. Excluding this `Catch` configuration means that any execution records saved for your failed workflows will not include details about the exceptions.
* States may be configured to `Retry` a task on specified failures to handle transient issues, such as those arising from resource allocation throttling, instead of failing the entire workflow. Cumulus supports the AWS retry configuration outlined [here](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html) and an example is provided in the `HelloWorld` step of the `RetryPassWorkflow` workflow defined in the Cumulus repository's [example workflows `errorsAndRetries.yml`](https://github.com/nasa/cumulus/blob/master/example/workflows/errorsAndRetries.yml).
* Tasks downstream of failed tasks should understand how to pass along exceptions if required: If a task throws an error which is caught by the workflow configuration and passed to another state which also uses the CMA, the CMA overrides the exception key to `"None"` so the exception will not be passed to downstream tasks after the next state. This is okay if the exception is not needed in downstream tasks. If the exception is needed in downstream tasks, you need to re-attach the exception to the Cumulus message by setting the `ResultPath` to be `$.exception` for the task where the error is initially caught. In the example below, `CnmResponseFail` catches and re-attaches the error to the message.
  * If multiple downstream tasks should run after a workflow task has thrown an error, you can create a separate failure branch of your workflow by chaining tasks that catch and re-attach the error as described above.
* Tasks that are lambdas should be configured to retry in the event of a Lambda Service Exception. See [this documentation](https://docs.aws.amazon.com/step-functions/latest/dg/bp-lambda-serviceexception.html) on configuring your workflow to handle transient lambda errors.

**Example:**

Note: In the example below, YAML syntax (i.e. `&ErrorEqualDefaults` and `<<: *ErrorEqualDefaults`) is used to create references to reusable blocks which makes the definition less repetitive. Read more here: [YAML - Anchors, References, Extend](https://blog.daemonl.com/2016/02/yaml.html).

```yaml
CNMExampleWorkflow:
  Comment: 'Tests Workflow from Kinesis Stream'
  StartAt: TranslateMessage
  States:
    TranslateMessage:
      Type: Task
      Resource: ${CNMToCMALambdaFunction.Arn}
      CumulusConfig:
        cumulus_message:
          outputs:
            - source: '{$.cnm}'
              destination: '{$.meta.cnm}'
            - source: '{$}'
              destination: '{$.payload}'
      Retry:
        - &LambdaServiceExceptionRetry
          ErrorEquals:
          - Lambda.ServiceException
          - Lambda.AWSLambdaException
          - Lambda.SdkClientException
          IntervalSeconds: 2
          MaxAttempts: 6
          BackoffRate: 2
      Catch:
        - &ErrorEqualDefaults
          ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: CnmResponseFail
      Next: SyncGranule
    SyncGranule:
      Type: Task
      Resource: ${SyncGranuleLambdaFunction.Arn}
      CumulusConfig:
        provider: '{$.meta.provider}'
        buckets: '{$.meta.buckets}'
        collection: '{$.meta.collection}'
        downloadBucket: '{$.meta.buckets.private.name}'
        stack: '{$.meta.stack}'
        cumulus_message:
          outputs:
            - source: '{$.granules}'
              destination: '{$.meta.input_granules}'
            - source: '{$}'
              destination: '{$.payload}'
      Retry:
        - ErrorEquals:
            - States.ALL
          IntervalSeconds: 10
          MaxAttempts: 3
      Catch:
        - <<: *ErrorEqualDefaults
      Next: CnmResponse
    CnmResponse: &CnmResponseDefaults
      CumulusConfig:
        OriginalCNM: '{$.meta.cnm}'
        CNMResponseStream: '{$.meta.cnmResponseStream}'
        region: 'us-east-1'
        WorkflowException: '{$.exception}'
        cumulus_message:
          outputs:
            - source: '{$}'
              destination: '{$.meta.cnmResponse}'
            - source: '{$}'
              destination: '{$.payload}'
      Type: Task
      Resource: ${CnmResponseLambdaFunction.Arn}
      Retry:
        - <<: *LambdaServiceExceptionRetry
      Catch:
        - <<: *ErrorEqualDefaults
          Next: WorkflowFailed
      Next: WorkflowSucceeded
    CnmResponseFail:
      <<: *CnmResponseDefaults
      Catch:
        - <<: *ErrorEqualDefaults
          Next: WorkflowFailed
      Next: WorkflowFailed
    WorkflowSucceeded:
      Type: Succeed
    WorkflowFailed:
      Type: Fail
      Cause: 'Workflow failed'
```

The above results in a workflow which is visualized in the diagram below:

![Kinesis Workflow](assets/kinesis-workflow.png)

## Summary

Error handling should (mostly) be the domain of workflow configuration.

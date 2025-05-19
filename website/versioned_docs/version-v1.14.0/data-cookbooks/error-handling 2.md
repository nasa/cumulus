---
id: version-v1.14.0-error-handling
title: Error Handling in Workflows
hide_title: true
original_id: error-handling
---

# Error Handling in Workflows

Cumulus Workflow error handling is configurable via Cumulus Workflow Definitions. These workflow definitions are AWS Step Function definitions, and AWS Step Functions enable users to configure what the state machine does next when an exception is thrown. Read more in the AWS docs: [How Step Functions Works: Error Handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html).

Cumulus Workflow Tasks _should_ throw errors and rely on the state machine logic to handle the error state. Errors and exceptions thrown in Cumulus Workflow Tasks using the Cumulus Message Adapter (CMA) are caught and rethrown by the CMA libraries _unless_ the error name contains `WorkflowError`.

The former (tasks which throw errors which are not `WorkflowError`s) is the expected behavior. However a `WorklowError` can be used to handle errors that should _not_ result in task failure.

## Workflow Configuration

Some best practices for error handling in Cumulus Workflows are:

* Include the `sf2snsEndLambdaFunction` as a final state (aka the `StopStatus` state). This broadcasts workflow results to an SNS topic.
* States should include a `Catch` configuration object which defines the `ResultPath` to be `$.exception`. This passes along the entire Cumulus Message to the next state with the addition of the `Error` and `Cause` details of the thrown error in the `exception` key.
* States may be configured to `Retry` a task on specified failures to handle transient issues, such as those arising from resource allocation throttling, instead of failing the entire workflow. Cumulus supports the AWS retry configuration outlined [here](https://docs.aws.amazon.com/step-functions/latest/dg/amazon-states-language-errors.html#amazon-states-language-retrying-after-error) and an example is provided in the `HelloWorld` step of the `RetryPassWorkflow` workflow defined in the Cumulus repository's [example](https://github.com/nasa/cumulus/blob/master/example/workflows.yml) `workflows.yml`.
* Tasks downstream of failed tasks should understand how to pass along exceptions if required: If a task throws an error which is caught by the workflow configuration and passed to another state which also uses the CMA, the CMA overrides the exception key to `"None"` so the exception will not be passed to downstream tasks after the next state. This is okay if the exception is not needed in downstream tasks. However, `sf2snsEndLambdaFunction` does need an exception to understand the workflow is in a failed state, so the error should be re-thrown in any states between the original failed task and `sf2snsEndLambdaFunction`. In the example below, `CnmResponseFail` re-throws any errors passed by upstream tasks.
* If multiple downstream tasks should run after a workflow task has thrown an error, for example sending a failure to a kinesis stream in addition to running the `sf2snsEndLambdaFunction`, this can handled by creating a second "failure" branch of the workflow.
* Tasks that are lambdas should be configured to retry in the event of a Lambda Service Exception. See [this documentation](https://docs.aws.amazon.com/step-functions/latest/dg/bp-lambda-serviceexception.html) on configuring your workflow to handle transient lambda errors.

**Example:**

Note: In the example below, YAML syntax (i.e. `&ErrorEqualDefaults` and `<<: *ErrorEqualDefaults`) is used to create references to reusable blocks which makes the definition less repetitive. Read more here: [YAML - Anchors, References, Extend](https://blog.daemonl.com/2016/02/yaml.html).

```yaml
CNMExampleWorkflow:
  Comment: 'Tests Workflow from Kinesis Stream'
  StartAt: StartStatus
  States:
    StartStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
      Catch:
        - &ErrorEqualDefaults
          ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: CnmResponseFail
      Next: TranslateMessage
    TranslateMessage:
      Type: Task
      Resource: ${CNMToCMALambdaFunction.Arn}
      Catch:
        - <<: *ErrorEqualDefaults
      Next: SyncGranule
    SyncGranule:
      Type: Task
      Resource: ${SyncGranuleLambdaFunction.Arn}
      Catch:
        - <<: *ErrorEqualDefaults
      Next: CnmResponse
    CnmResponse: &CnmResponseDefaults
      Type: Task
      Resource: ${CnmResponseLambdaFunction.Arn}
      Catch:
        - <<: *ErrorEqualDefaults
          Next: StopStatus
      Next: StopStatus
    CnmResponseFail:
      <<: *CnmResponseDefaults
      Catch:
        - <<: *ErrorEqualDefaults
          Next: StopStatusFail
      Next: StopStatusFail
    StopStatus: &StopStatusDefaults
      Type: Task
      Resource: ${sf2snsEndLambdaFunction.Arn}
      Next: WorkflowSucceeded
    StopStatusFail:
      <<: *StopStatusDefaults
      Catch:
        - ErrorEquals:
          - States.ALL
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

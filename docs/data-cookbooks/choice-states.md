# Choice States

Cumulus supports [AWS Step Function `Choice` states](https://docs.aws.amazon.com/step-functions/latest/dg/amazon-states-language-choice-state.html). A `Choice` state enables branching logic in Cumulus workflows.

`Choice` state definitions include a list of `Choice Rule`s. Each `Choice Rule` defines a logical operation which compares an input value against a specified value using a comparison operator. If the comparison evaluates to `true`, the `Next` state is followed.

Note:

> Step Functions examines each of the Choice Rules in the order listed in the Choices field and transitions to the state specified in the Next field of the first Choice Rule in which the variable matches the value according to the comparison operator.

## Example

In [examples/workflow.yml](https://github.com/nasa/cumulus/blob/master/example/workflows.yml) the `ParsePdr` workflow uses a `Choice` state, `CheckAgainChoice`, to terminate the workflow once the `isFinished` boolean has been assigned the value `true` by the `CheckStatus` state.

The `CheckAgainChoice` state definition requires an input object of the following structure:

```json
{
  "payload": {
    "isFinished": false
  }
}
```

With this input object, the following `Choice` state would transition to the `PdrStatusReport` state.

```yaml
    CheckAgainChoice:
      Type: Choice
      Choices:
        - Variable: $.payload.isFinished
          BooleanEquals: false
          Next: PdrStatusReport
        - Variable: $.payload.isFinished
          BooleanEquals: true
          Next: StopStatus
```

## Advanced: Loops in Cumulus Workflows

Understanding the complete `ParsePdr` workflow is not necessary to understanding how `Choice` states work, but `ParsePdr` provides an example of how `Choice` states can be used to create a loop in a Cumulus workflow. 

In the complete `ParsePdr` workflow definition, the state `QueueGranules` is followed by `CheckStatus`. From `CheckStatus` a loop starts: Given `CheckStatus` returns `payload.isFinished = false`, `CheckStatus` is followed by `CheckAgainChoice` is followed by `PdrStatusReport` is followed by `WaitForSomeTime`, which returns to `CheckStatus`. Once `CheckStatus` returns `payload.isFinished = true`, `CheckAgainChoice` proceeds to `StopStatus`.

## Further documentation

For complete details on `Choice` state configuration options, see [the Choice state documentation](https://docs.aws.amazon.com/step-functions/latest/dg/amazon-states-language-choice-state.html).


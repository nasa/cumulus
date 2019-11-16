# Cumulus - Workflow module

## Included resources

Creates an AWS Step Function and Cloudwatch rules triggered by events for the Step Function.

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

## Outputs

- **name** - Name of the Step Function
- **state_machine_arn** - ARN for the Step Function

## Example

```hcl
module "my_workflow" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus-workflow.zip"

  prefix = "my-prefix"
  name   = "MyWorkflowName"
  system_bucket = "my-internal-bucket"

  state_machine_definition = <<JSON
{
  "Comment": "Returns Hello World",
  "StartAt": "HelloWorld",
  "States": {
    "HelloWorld": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "buckets": "{$.meta.buckets}",
            "provider": "{$.meta.provider}",
            "collection": "{$.meta.collection}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.hello_world_task.task_arn}",
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
      "End": true
    }
  }
}
JSON
}
```

# Cumulus - Task module

## Included resources

Creates a task Lambda function and its CloudWatch log group.

This module also sets default Lambda environment variables:

- `stackName` (from `prefix`)
- `CUMULUS_MESSAGE_ADAPTER_DIR` (`/opt/`)

If `subnet_ids` is provided, the Lambda function is configured to run in a VPC using `security_group_id`.

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

## Outputs

- **cumulus_task_lambda** - The created Lambda function resource
- **cumulus_task_log_group_name** - Name of the Lambda CloudWatch log group

## Example

```hcl
module "example_task" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus-task.zip"

  prefix          = "my-prefix"
  name            = "my-task"
  role            = "arn:aws:iam::123456789012:role/my-lambda-role"
  lambda_zip_path = abspath("${path.module}/dist/final/lambda.zip")

  subnet_ids        = ["subnet-1234567890abcdef0"]
  security_group_id = "sg-0123456789abcdef0"

  timeout     = 900
  memory_size = 4096

  tags = {
    Project = "cumulus"
  }
}
```

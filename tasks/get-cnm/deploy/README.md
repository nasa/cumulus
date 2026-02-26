# get-cnm deploy module

This Terraform configuration deploys the `get-cnm` Lambda task using the shared [cumulus-task](../../../tf-modules/cumulus-task/README.md) module.

## What this deploy config does

- Uses the provided Lambda execution role ARN (`lambda_processing_role_arn`)
- Resolves private application subnet IDs for the current region
- Creates the `get-cnm-task` Lambda function from `../dist/final/lambda.zip`
- Applies timeout, memory, VPC, and tags settings

## Prerequisites

- Build the task package so `tasks/get-cnm/dist/final/lambda.zip` exists
- Terraform and AWS credentials configured for the target account/region
- A valid Lambda execution role ARN provided via `lambda_processing_role_arn`
- A subnet with tag name `Private application <region>a subnet`

## Usage

From this directory:

```bash
cd tasks/get-cnm/deploy

# Required deploy-time variables
export TF_VAR_prefix=<your_prefix>
export TF_VAR_lambda_processing_role_arn='arn:aws:iam::<account-id>:role/<role-name>'

# Optional
export TF_VAR_tags='{"Project":"cumulus"}'

terraform init
terraform apply
```

## Inputs

| Name | Description | Type | Default | Required |
| --- | --- | --- | --- | :---: |
| lambda_processing_role_arn | The ARN of the IAM role to use for the Lambda function. | `string` | n/a | yes |
| lambda_timeout | The timeout value for the Lambda function in seconds | `number` | n/a | yes |
| lambda_memory_size | The memory size for the Lambda function in MB | `number` | n/a | yes |
| security_group_id | Security group ID for Lambda VPC configuration | `string` | `""` | no |
| prefix | The prefix for resource names | `string` | n/a | yes |
| tags | A map of tags to apply to resources | `map(string)` | `{}` | no |

Default values for task-specific settings are in [terraform.tfvars](./terraform.tfvars).

## Notes

- This deploy config includes a Terraform `check` block that fails early when no subnets match the expected tag name for the current region.

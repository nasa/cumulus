# aws-api-proxy deploy module

This Terraform configuration deploys the `aws-api-proxy` Lambda task using the shared [cumulus-task](../../../tf-modules/cumulus-task/README.md) module.

## What this deploy config does

- Resolves a Lambda execution role by regex (`lambda_processing_role_pattern`)
- Resolves private application subnet IDs for the current region
- Creates the `aws-api-proxy` Lambda function from `../dist/final/lambda.zip`
- Applies timeout, memory, VPC, and tags settings

## Prerequisites

- Build the task package so `tasks/aws-api-proxy/dist/final/lambda.zip` exists
- Terraform and AWS credentials configured for the target account/region
- A role that matches `lambda_processing_role_pattern`
- A subnet with tag name `Private application <region>a subnet`

## Usage

From this directory:

```bash
cd tasks/aws-api-proxy/deploy

# Required deploy-time variables
export TF_VAR_prefix=<your_prefix>
export TF_VAR_lambda_processing_role_pattern='^<your-prefix>-.*lambda-processing.*$'

# Optional
export TF_VAR_tags='{"Project":"cumulus"}'

terraform init
terraform apply
```

## Inputs

| Name | Description | Type | Default | Required |
| --- | --- | --- | --- | :---: |
| lambda_processing_role_pattern | Regex pattern to match IAM role name when lambda_processing_role_arn is not provided | `string` | n/a | yes |
| lambda_timeout | The timeout value for the Lambda function in seconds | `number` | n/a | yes |
| lambda_memory_size | The memory size for the Lambda function in MB | `number` | n/a | yes |
| security_group_id | Security group ID for Lambda VPC configuration | `string` | `""` | no |
| prefix | The prefix for resource names | `string` | n/a | yes |
| tags | A map of tags to apply to resources | `map(string)` | `{}` | no |

Default values for task-specific settings are in [terraform.tfvars](./terraform.tfvars).

## Notes

- This deploy config includes Terraform `check` blocks that fail early if the role pattern does not match exactly one role or if no expected subnet is found.

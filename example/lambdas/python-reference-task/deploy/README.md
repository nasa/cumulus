# Python Reference Task Terraform Module

This module creates the Python Reference Task Lambda function used in Cumulus workflows.

## Usage

```hcl
module "python_reference_task" {
  source = "../lambdas/python-reference-task/deploy"

  prefix                                         = var.prefix
  lambda_processing_role_arn                     = module.cumulus.lambda_processing_role_arn
  cumulus_message_adapter_lambda_layer_version_arn = var.cumulus_message_adapter_lambda_layer_version_arn
  lambda_subnet_ids                              = var.lambda_subnet_ids
  lambda_security_group_id                       = aws_security_group.no_ingress_all_egress.id
  tags                                           = local.tags
}
```

## Requirements

- The Lambda deployment package must be built and available at `../dist/lambda.zip` relative to this module
- Terraform >= 1.0
- AWS Provider >= 5.0

## Inputs

| Name | Description | Type | Default | Required |
| ------ | ------------- | ------ | --------- | :--------: |
| prefix | The prefix for resource names | `string` | n/a | yes |
| lambda_processing_role_arn | ARN of the IAM role for Lambda execution | `string` | n/a | yes |
| cumulus_message_adapter_lambda_layer_version_arn | ARN of the Cumulus Message Adapter Lambda layer | `string` | n/a | yes |
| lambda_subnet_ids | List of subnet IDs for Lambda VPC configuration | `list(string)` | `[]` | no |
| lambda_security_group_id | Security group ID for Lambda VPC configuration | `string` | `""` | no |
| tags | Tags to be applied to resources | `map(string)` | `{}` | no |

## Outputs

| Name | Description |
| ------ | ------------- |
| lambda_function_arn | ARN of the Python reference task Lambda function |
| lambda_function_name | Name of the Python reference task Lambda function |
| lambda_function_invoke_arn | Invoke ARN of the Python reference task Lambda function |

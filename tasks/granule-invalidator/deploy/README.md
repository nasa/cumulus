# Granule-invalidator Terraform Module

This module creates the granule invalidator Lambda function used in Cumulus workflows.

## Usage

```hcl
module "granule_invalidator" {
  source = "../lambdas/granule-invalidator/deploy"

  prefix                       = var.prefix
  role                         = module.cumulus.lambda_processing_role_arn
  layers                       = [var.cumulus_message_adapter_lambda_layer_version_arn]
  subnet_ids                   = var.lambda_subnet_ids
  security_group_id            = aws_security_group.no_ingress_all_egress.id
  default_log_retention_days   = var.default_log_retention_days
  tags                         = local.tags
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
| role | ARN of the IAM role for Lambda execution | `string` | n/a | yes |
| layers | ARN of the Cumulus Message Adapter Lambda layer | `list(string)` | n/a | yes |
| default_log_retention_days | The number of days to retain logs in CloudWatch | `number` | n/a | yes |
| subnet_ids | List of subnet IDs for Lambda VPC configuration | `list(string)` | `[]` | no |
| security_group_id | Security group ID for Lambda VPC configuration | `string` | `""` | no |
| timeout | Timeout value for the Lambda function in seconds | `number` | `900` | no |
| memory_size | Memory size for the Lambda function in MB | `number` | `4096` | no |
| environment | Environment variables for the Lambda function. This is a map that's merged with a set of defaults. | `map(string)` | `{}` | no |
| tags | Tags to be applied to resources | `map(string)` | `{}` | no |

## Outputs

| Name | Description |
| ------ | ------------- |
| lambda_function_arn | ARN of the Lambda function |
| lambda_function_name | Name of the Lambda function |
| lambda_function_invoke_arn | Invoke ARN of the Lambda function |

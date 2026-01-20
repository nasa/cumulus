# Python Reference Activity Terraform Module

This module creates the Python Reference Activity ECS service used in Cumulus workflows.

## Usage

```hcl
module "python_processing_service" {
  source = "../lambdas/python-reference-activity/deploy"

  prefix = var.prefix
  cluster_arn                           = module.cumulus.ecs_cluster_arn
  tags   = local.tags
}
```

## Requirements

- The task Docker image and version must be available in ECR.
- Terraform >= 1.0
- AWS Provider >= 5.0

## Inputs

| Name | Description | Type | Default | Required |
| ------ | ------------- | ------ | --------- | :--------: |
| aws_region | AWS region | `string` | us-east-1 | no |
| prefix | The prefix for resource names | `string` | n/a | yes |
| cumulus_ecs_cluster_arn | ARN of the Cumulus ECS cluster to target for this service | `string` | n/a | yes |
| cumulus_process_activity_version | Docker image version to use for this service | `string` | n/a | yes |
| tags | Tags to be applied to resources | `map(string)` | `{}` | no |

## Outputs

| Name | Description |
| ------ | ------------- |
| activity_arn | ARN of the Step Functions activity |
| activity_id | ID of the Step Functions activity |
| service_name | Name of the ECS service |

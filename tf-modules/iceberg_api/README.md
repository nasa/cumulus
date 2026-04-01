# Iceberg API Module

This module deploys the Cumulus Iceberg API service as an ECS Fargate service with an Application Load Balancer.

## Features

- ECR repository for Iceberg API container images
- ECS Fargate service with task definition
- Application Load Balancer with SSL/TLS termination
- CloudWatch logging
- Auto-scaling based on CPU utilization
- Security groups for ALB and ECS tasks

## Usage

```hcl
module "iceberg_api" {
  source = "../../tf-modules/iceberg_api"

  prefix             = "my-cumulus"
  region             = "us-west-2"
  vpc_id             = "vpc-12345678"
  tags               = {
    Environment = "dev"
    Project     = "cumulus"
  }

  oauth_provider           = "earthdata"
  api_config_secret_arn    = "arn:aws:secretsmanager:us-west-2:123456789012:secret:cumulus/api-config"
  iceberg_api_cpu          = 256
  iceberg_api_memory       = 512
  cumulus_iceberg_api_image_version = "latest"

  ecs_execution_role_arn   = "arn:aws:iam::123456789012:role/cumulus-ecs-execution-role"
  ecs_task_role_arn        = "arn:aws:iam::123456789012:role/cumulus-ecs-task-role"
  ecs_cluster_arn          = "arn:aws:ecs:us-west-2:123456789012:cluster/cumulus-cluster"
  ecs_cluster_name         = "cumulus-cluster"
  ecs_cluster_instance_subnet_ids = ["subnet-12345678", "subnet-87654321"]

  rds_security_group_id = "sg-12345678"

  api_service_autoscaling_min_capacity = 1
  api_service_autoscaling_max_capacity = 10
  api_service_autoscaling_target_cpu   = 70
}
```

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.12 |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| prefix | Prefix to use for resource names | `string` | n/a | yes |
| region | AWS region | `string` | n/a | yes |
| vpc_id | VPC ID | `string` | n/a | yes |
| tags | Tags to apply to resources | `map(string)` | `{}` | no |
| oauth_provider | OAuth provider | `string` | n/a | yes |
| api_config_secret_arn | ARN of the API config secret | `string` | n/a | yes |
| iceberg_api_cpu | CPU allocation for Iceberg API ECS task | `number` | `256` | no |
| iceberg_api_memory | Memory allocation for Iceberg API ECS task | `number` | `512` | no |
| cumulus_iceberg_api_image_version | Version of the Cumulus Iceberg API image | `string` | n/a | yes |
| ecs_execution_role_arn | ARN of the ECS execution role | `string` | n/a | yes |
| ecs_task_role_arn | ARN of the ECS task role | `string` | n/a | yes |
| ecs_cluster_arn | ARN of the ECS cluster | `string` | n/a | yes |
| ecs_cluster_name | Name of the ECS cluster | `string` | n/a | yes |
| ecs_cluster_instance_subnet_ids | Subnet IDs for ECS cluster instances | `list(string)` | n/a | yes |
| rds_security_group_id | ID of the RDS security group | `string` | n/a | yes |
| api_service_autoscaling_min_capacity | Minimum capacity for API service autoscaling | `number` | `1` | no |
| api_service_autoscaling_max_capacity | Maximum capacity for API service autoscaling | `number` | `10` | no |
| api_service_autoscaling_target_cpu | Target CPU utilization for API service autoscaling | `number` | `70` | no |

## Outputs

| Name | Description |
|------|-------------|
| iceberg_api_lb_dns_name | DNS name of the Iceberg API load balancer |
| iceberg_api_lb_id | ID of the Iceberg API load balancer |

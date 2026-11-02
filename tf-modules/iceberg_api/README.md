# Iceberg API Module

This module deploys the Cumulus Iceberg API service as an ECS Fargate service with an Application Load Balancer.

## Features

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
  aws_account_id           = "123456789012"
  system_bucket            = "my-system-bucket"
  iceberg_namespace        = "my_iceberg_db"
  iceberg_s3_bucket        = "my-iceberg-bucket"
  iceberg_api_cpu          = 512
  iceberg_api_memory       = 1024
  duckdb_max_pool_size     = 3
  duckdb_pool_rebuild_interval_seconds = 18000
  cumulus_iceberg_api_image_repository_url = "ghcr.io/nasa/cumulus-iceberg-api"
  cumulus_iceberg_api_image_version = "latest"

  ecs_execution_role_arn   = "arn:aws:iam::123456789012:role/cumulus-ecs-execution-role"
  ecs_cluster_arn          = "arn:aws:ecs:us-west-2:123456789012:cluster/cumulus-cluster"
  ecs_cluster_name         = "cumulus-cluster"
  ecs_cluster_instance_subnet_ids = ["subnet-12345678", "subnet-87654321"]

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
| aws_account_id | AWS account ID used to attach the Glue Iceberg catalog | `string` | n/a | yes |
| system_bucket | Name of the Cumulus system S3 bucket (used for auth config and other system resources) | `string` | n/a | yes |
| iceberg_namespace | AWS Glue schema (database) name containing the Iceberg tables | `string` | n/a | yes |
| iceberg_s3_bucket | Name of the S3 bucket the Iceberg API task needs read access to | `string` | n/a | yes |
| iceberg_api_cpu | CPU allocation for Iceberg API ECS task | `number` | `512` | no |
| iceberg_api_memory | Memory allocation for Iceberg API ECS task | `number` | `1024` | no |
| duckdb_max_pool_size | Maximum number of DuckDB connections in the connection pool | `number` | `3` | no |
| duckdb_pool_rebuild_interval_seconds | Seconds between preemptive DuckDB idle-pool rebuilds | `number` | `18000` | no |
| cumulus_iceberg_api_image_repository_url | Repository URL of the Cumulus Iceberg API image | `string` | `null` | no |
| cumulus_iceberg_api_image_version | Version of the Cumulus Iceberg API image | `string` | n/a | yes |
| ecs_execution_role_arn | ARN of the ECS execution role | `string` | n/a | yes |
| ecs_cluster_arn | ARN of the ECS cluster | `string` | n/a | yes |
| ecs_cluster_name | Name of the ECS cluster | `string` | n/a | yes |
| ecs_cluster_instance_subnet_ids | Subnet IDs for ECS cluster instances | `list(string)` | n/a | yes |
| api_service_autoscaling_min_capacity | Minimum capacity for API service autoscaling | `number` | `1` | no |
| api_service_autoscaling_max_capacity | Maximum capacity for API service autoscaling | `number` | `10` | no |
| api_service_autoscaling_target_cpu | Target CPU utilization for API service autoscaling | `number` | `70` | no |
| iceberg_health_check_grace_period_seconds | Seconds to ignore failing load balancer health checks on newly instantiated ECS tasks | `number` | `180` | no |
| cloudwatch_log_retention_periods | retention periods for the respective cloudwatch log group, these values will be used instead of default retention days | `map(number)` | `{}` | no |
| default_log_retention_days | default value that user chooses for their log retention periods | `number` | `30` | no |

## Outputs

| Name | Description |
|------|-------------|
| iceberg_api_uri | URI for the Iceberg API |

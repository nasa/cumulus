variable "prefix" {
  description = "Prefix to use for resource names"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

variable "oauth_provider" {
  description = "OAuth provider"
  type        = string
}

variable "api_config_secret_arn" {
  description = "ARN of the API config secret"
  type        = string
}

variable "iceberg_api_cpu" {
  description = "CPU allocation for Iceberg API ECS task"
  type        = number
  default     = 256
}

variable "iceberg_api_memory" {
  description = "Memory allocation for Iceberg API ECS task"
  type        = number
  default     = 512
}

variable "cumulus_iceberg_api_image_version" {
  description = "Version of the Cumulus Iceberg API image"
  type        = string
}

variable "ecs_execution_role_arn" {
  description = "ARN of the ECS execution role"
  type        = string
}

variable "ecs_task_role_arn" {
  description = "ARN of the ECS task role"
  type        = string
}

variable "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  type        = string
}

variable "ecs_cluster_instance_subnet_ids" {
  description = "Subnet IDs for ECS cluster instances"
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "ID of the RDS security group"
  type        = string
}

variable "api_service_autoscaling_min_capacity" {
  description = "Minimum capacity for API service autoscaling"
  type        = number
  default     = 1
}

variable "api_service_autoscaling_max_capacity" {
  description = "Maximum capacity for API service autoscaling"
  type        = number
  default     = 10
}

variable "api_service_autoscaling_target_cpu" {
  description = "Target CPU utilization for API service autoscaling"
  type        = number
  default     = 70
}

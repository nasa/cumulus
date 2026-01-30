variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "prefix" {
  description = "The prefix for resource names"
  type        = string
}

variable "cumulus_ecs_cluster_arn" {
  description = "ARN of the Cumulus ECS cluster"
  type        = string
}

variable "cumulus_test_ingest_image_version" {
    description = "Docker image version to use for this service"
    type        = string
}

variable "tags" {
  description = "Tags to be applied to resources"
  type        = map(string)
  default     = {}
}

variable "default_log_retention_days" {
  type = number
  description = "CloudWatch log retention in days"
}

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "Retention periods for the respective Cloudwatch log group. These values will be used instead of default retention days"
}

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}

variable "region" {
  description = "Region to deploy module to"
  type        = string
  default     = "us-west-2"
}

variable "task_security_group_id" {
  description = "Security group to use for tasks"
  type        = string
}

variable "subnet" {
  description = "Subnet for Fargate tasks. We only use one since we are using EBS volumes which don't work across multiple AZs."
  type        = string
}

variable "cpu" {
  description = "The number of CPU units the Amazon ECS container agent will reserve for the task"
  type        = number
  default     = 2048 # 2 CPUs
}

variable "cpu_architecture" {
  description = "The architecture of the cpu platform. Valid values are X86_65 and ARM64"
  type        = string
  default     = "ARM64"
}

variable "memory" {
  description = "The amount of memory (in MB) that the ECS container agent reserves for a task."
  type        = number
  default     = 4096 # 4GB
}

variable "iceberg_cleanup_image" {
  description = "Image used to start the iceberg cleanup container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
  type        = string
}

variable "tags" {
  description = "Tags to be applied to RDS cluster resources that support tags"
  type        = map(string)
  default     = {}
}

variable "table_include_list" {
  description = "comma-separated list of dB tables to be replicated"
  type        = string
}

variable "iceberg_s3_bucket" {
  description = "S3 bucket where iceberg tables are stored"
  type        = string
}

variable "iceberg_namespace" {
  description = "iceberg namespace (same as glue database)"
  type        = string
}

variable "ecs_task_execution_role" {
  description = "IAM role used by Docker daemon and ECS container agent"
  type = object({
    arn  = string
    name = string
  })
}

variable "ecs_cluster" {
  description = "The ECS cluster to which the replication service will belong"
  type = object({
    arn  = string
    name = string
    id   = string
  })
}

variable "older_than_minutes" {
  description = "Expire snapshots older than this many minutes"
  type        = number
  default     = 120
}

variable "retain_last" {
  description = "Minimum number of snapshots to retain regardless of age"
  type        = number
  default     = 2
}

variable "cleanup_interval_minutes" {
  description = "How often to run the snapshot cleanup task"
  type        = number
  default     = 60
}

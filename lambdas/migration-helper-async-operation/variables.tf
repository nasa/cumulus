variable "async_operation_task_definition_arn" {
  type = string
}

variable "buckets" {
  type    = map(object({ name = string, type = string }))
  default = {}
}
variable "dla_migration_function_arn" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_execution_role_arn" {
  description = "ARN of IAM role for initializing ECS tasks"
  type = string
}

variable "ecs_task_role_arn" {
  description = "ARN of IAM role for running ECS tasks"
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type = map(number)
  default = {}
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type = map(number)
  default = {}
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}
variable "rds_connection_timing_configuration" {
  description = "Cumulus rds connection timeout retry timing object -- these values map to knex.js's internal use of  https://github.com/vincit/tarn.js/ for connection acquisition"
  type = map(number)
  default = {
      acquireTimeoutMillis: 60000
      createRetryIntervalMillis: 30000,
      createTimeoutMillis: 20000,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
  }
}

variable "rds_security_group_id" {
  type = string
}

variable "rds_user_access_secret_arn" {
  description = "RDS User Database Login Credential Secret ID"
  type        = string
}

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type        = string
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  type    = string
  default = null
}

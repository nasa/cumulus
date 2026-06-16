# Required

variable "prefix" {
  description = "prefix to use for naming created resources"
  type        = string
}

variable "permissions_boundary_arn" {
  type = string
}

# Optional

variable "enable_point_in_time_tables" {
  description = "DynamoDB table names that should have point in time recovery enabled"
  type        = list(string)
  default = [
    "UsersTable"
  ]
}

variable "subnet_ids" {
  description = "Subnet IDs that should be used when using a Postgres database inside of a VPC"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

variable "rds_user_access_secret_arn" {
  description = "AWS Secrets Manager secret ARN containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type        = string
}

variable "rds_security_group_id" {
  type    = string
  default = ""
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "db_migration_lambda_timeout" {
  description = "Timeout in seconds for the database schema migration lambda.   Defaults to 900 seconds"
  type        = number
  default     = 900
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type        = map(number)
  default     = {}
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type        = map(number)
  default     = {}
}

variable "db_partition_config" {
  type = object({
    # By adding optional(type, default), Terraform handles the null fallback automatically
    executions_total_years     = optional(number, 2)
    granules_count             = optional(number, 512)
    files_count                = optional(number, 1024)
    executions_retention_years = optional(number, null)
  })
  description = <<EOT
    Configuration for database table partitioning:
    - executions_total_years: How many years ahead to generate quarterly partitions for 'executions'.
    - granules_count: The number of hash/bigint-based partitions to create for the 'granules' table.
    - files_count: The number of hash/bigint-based partitions to create for the 'files' table.
    - executions_retention_years: The number of years to retain execution partitions. Setting to null or 0 disables partition deletion.
  EOT

  # Force Terraform to drop incoming null values and use the default block instead
  nullable = false

  # Fallback if the user completely omits the db_partition_config block
  default = {
    executions_total_years     = 2
    granules_count             = 512
    files_count                = 1024
    executions_retention_years = null
  }
}

variable "use_bootstrap" {
  description = "If true, builds the schema from scratch using the bootstrap directory (full declarations) instead of incremental patches. Only runs on fresh databases."
  type        = bool
  default     = false
}

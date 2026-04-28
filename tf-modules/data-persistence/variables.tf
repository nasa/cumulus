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

variable "use_bootstrap" {
  description = "Whether to run the bootstrap migrations when creating database schemas"
  type        = bool
  default     = false
}

variable "db_partition_config" {
  type = object({
    executions_base_year   = number
    executions_total_years = number
    granules_count         = number
    files_count            = number
  })
  description = <<EOT
    Configuration for database table partitioning:
    - executions_base_year: The starting year for time-based partitions in the 'executions' table.
    - executions_total_years: How many years worth of quarterly partitions to generate for 'executions'.
    - granules_count: The number of hash/bigint-based partitions to create for the 'granules' table.
    - files_count: The number of hash/bigint-based partitions to create for the 'files' table.
  EOT

  default = {
    executions_base_year   = 2026
    executions_total_years = 2
    granules_count         = 8
    files_count            = 8
  }
}

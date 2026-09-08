variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "rds_user_access_secret_arn" {
  description = "AWS Secrets Manager secret ARN containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type        = string
}

variable "rds_security_group_id" {
  type    = string
  default = ""
}

variable "lambda_timeout" {
  description = "Timeout in seconds for the database schema migration lambda.   Defaults to 900 seconds"
  type        = number
  default     = 900
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "db_partition_config" {
  type = object({
    executions_total_years       = number
    granules_count               = number
    files_count                  = number
    granules_global_unique_count = number
    files_global_unique_count    = number
  })
  description = "Partitioning settings for the database migration Lambda"
}

variable "use_bootstrap" {
  description = "If true, builds the schema from scratch using the bootstrap directory (full declarations) instead of incremental patches. Only runs on fresh databases."
  type        = bool
}

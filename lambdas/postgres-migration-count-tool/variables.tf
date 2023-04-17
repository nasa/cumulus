
variable "buckets" {
  type    = map(object({ name = string, type = string }))
  default = {}
}

variable "dynamo_tables" {
  description = "A map of objects with the `arn` and `name` of every DynamoDB table for your Cumulus deployment."
  type        = map(object({ name = string, arn = string }))
}

variable "lambda_subnet_ids" {
  type = list(string)
  default = []
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
  default = null
}

variable "rds_user_access_secret_arn" {
  description = "RDS User Database Login Credential Secret ID"
  type        = string
}

variable "rds_connection_timing_configuration" {
  description = "Cumulus rds connection timeout retry timing object -- these values map to knex.js's internal use of  https://github.com/vincit/tarn.js/ for connection acquisition"
  type = map(number)
  default = {
      acquireTimeoutMillis: 90000
      createRetryIntervalMillis: 30000,
      createTimeoutMillis: 20000,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
  }
}

variable "rds_security_group_id" {
  type = string
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

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "Optional retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 30
  description = "Optional default value that user chooses for their log retention periods"
}

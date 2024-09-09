# Required

variable "dynamo_tables" {
  description = "A map of objects with the `arn` and `name` of every DynamoDB table for your Cumulus deployment."
  type        = map(object({ name = string, arn = string }))
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
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

# Optional

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

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "rds_security_group_id" {
  description = "RDS Security Group used for access to RDS cluster"
  type        = string
  default     = ""
}

variable "rds_connection_heartbeat" {
  description = "If true, send a query to verify database connection is live on connection creation and retry on initial connection timeout.  Set to false if not using serverless RDS"
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "vpc_id" {
  type    = string
  default = null
}

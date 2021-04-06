variable "async_operation_task_definition_arn" {
  type = string
}

variable "data_migration2_function_arn" {
  type = string
}

variable "dynamo_tables" {
  description = "A map of objects with the `arn` and `name` of every DynamoDB table for your Cumulus deployment."
  type        = map(object({ name = string, arn = string }))
}

variable "ecs_cluster_name" {
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}
variable "rds_connection_heartbeat" {
  description = "If true, send a query to verify database connection is live on connection creation and retry on initial connection timeout.  Set to false if not using serverless RDS"
  type    = bool
  default = true
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


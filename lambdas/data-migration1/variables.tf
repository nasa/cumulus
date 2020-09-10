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

# Optional

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
  description = "Sets if Core database code should send a query to verify db connection on creation/rety on connection timeout"
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

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "dynamo_tables" {
  description = "A map of objects with the `arn` and `name` of every DynamoDB table for your Cumulus deployment."
  type        = map(object({ name = string, arn = string }))
}

variable "pg_host" {
  type = string
}

variable "pg_user" {
  type = string
}

variable "pg_password" {
  type = string
}

variable "pg_database" {
  type = string
}

variable "lambda_subnet_ids" {
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

variable "cmr_environment" {
  type = string
}

variable "cumulus_message_adapter_lambda_layer_arn" {
  type = string
}

variable "dynamo_tables" {
  type = map(object({ name = string, arn = string }))
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = null
}

variable "log2elasticsearch_lambda_function_arn" {
  type = string
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "system_bucket" {
  type = string
}

variable "vpc_id" {
  type    = string
  default = null
}

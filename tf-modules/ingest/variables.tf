variable "cmr_environment" {
  type = string
}

variable "dynamo_tables" {
  type = map(string)
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type = list(string)
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
  type = string
}

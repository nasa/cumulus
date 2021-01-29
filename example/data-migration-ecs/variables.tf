variable "prefix" {
  type = string
  default = null
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "ecs_cluster_arn" {
  type    = string
  default = null
}

variable "permissions_boundary_arn" {
  type    = string
  default = null
}

variable "subnet_ids" {
  type = list(string)
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "log2elasticsearch_lambda_function_arn" {
  type    = string
  default = null
}

variable "data_migration2_function_arn" {
  type    = string
  default = null
}

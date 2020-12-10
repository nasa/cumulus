variable "data_persistence_remote_state_config" {
  type = object({ bucket = string, key = string, region = string })
}

variable "permissions_boundary_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "prefix" {
  type = string
  default = null
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "aws_profile" {
  type    = string
  default = null
}

variable "log2elasticsearch_lambda_function_arn" {
  type    = string
  default = null
}

variable "ecs_cluster_arn" {
  type    = string
  default = null
}

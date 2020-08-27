variable "aws_profile" {
  type    = string
  default = null
}

variable "permissions_boundary_arn" {
  type = string
}

variable "rds_access_secret_arn" {
  type = string
  default = null
}

variable "rds_security_group" {
  type = string
  default = null
}

variable "prefix" {
  type = string
  default = null
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "data_persistence_remote_state_config" {
  type = object({ bucket = string, key = string, region = string })
}

variable "subnet_ids" {
  type = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "vpc_id" {
  type    = string
  default = null
}

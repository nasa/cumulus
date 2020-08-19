variable "aws_profile" {
  type    = string
  default = null
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
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

variable "region" {
  type    = string
  default = "us-east-1"
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

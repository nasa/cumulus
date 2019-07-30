# Required

variable "prefix" {
  type    = string
}

variable "executions_table" {
  type    = string
}

# Optional

variable "aws_profile" {
  type    = string
  default = "default"
}

variable "aws_region" {
  type    = string
  default = "default"
}

variable "permissions_boundary" {
  type    = string
  default = null
}

variable "security_groups" {
  type    = list(string)
  default = []
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

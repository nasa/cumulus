
variable "security_group_ids" {
  type    = list(string)
  default = null
}

variable "permissions_boundary_arn" {
  type = string
}

variable "vpc_id" {
  type    = string
  default = ""
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

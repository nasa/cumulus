
variable "security_group_ids" {
  type    = list(string)
  default = null
}

variable "prefix" {
  type = string
}

variable "permissions_boundary" {
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

variable "target_bucket" {
  type = string
}

variable "target_prefix" {
  type = string
}

variable "source_bucket" {
  type = string
}

variable "source_prefix" {
  type = string
}

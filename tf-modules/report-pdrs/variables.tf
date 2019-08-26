# Required

variable "prefix" {
  type = string
}

variable "pdrs_table" {
  type = string
}

# Optional

variable "permissions_boundary" {
  type    = string
  default = null
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_groups" {
  type    = list(string)
  default = []
}

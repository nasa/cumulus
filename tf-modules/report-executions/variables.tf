# Required

variable "prefix" {
  type = string
}

variable "executions_table" {
  type = string
}

# Optional

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

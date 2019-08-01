# Required

variable "prefix" {
  type    = string
}

# Optional

variable "enable_point_in_time_recovery" {
  type    = bool
  default = false
}

variable "vpc_id" {
  type    = string
  default = ""
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_groups" {
  type    = list(string)
  default = []
}

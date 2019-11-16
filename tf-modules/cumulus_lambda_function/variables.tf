# Required

variable "filename" {
  type = string
}

variable "function_name" {
  type = string
}

variable "handler" {
  type = string
}

variable "prefix" {
  type = string
}

variable "role" {
  type = string
}

variable "runtime" {
  type = string
}

variable "system_bucket" {
  type = string
}

# Optional

variable "enable_versioning" {
  type    = bool
  default = false
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "layers" {
  type    = list(string)
  default = []
}

variable "memory_size" {
  type    = number
  default = null
}

variable "security_group_ids" {
  type    = list(string)
  default = null
}

variable "subnet_ids" {
  type    = list(string)
  default = null
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "task_version" {
  type    = string
  default = null
}

variable "timeout" {
  type    = number
  default = null
}

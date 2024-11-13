
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

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

variable "target_bucket" {
  type = string
}

variable "target_prefix" {
  type = string
}

variable "target_region" {
  type    = string
  default = ""
}

variable "source_bucket" {
  type = string
}

variable "source_prefix" {
  type = string
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type = map(number)
  default = {}
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type = map(number)
  default = {}
}


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

variable "source_bucket" {
  type = string
}

variable "source_prefix" {
  type = string
}

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "Optional retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 21
  description = "Optional default value that user chooses for their log retention periods"
}

variable "prefix" {
  type = string
}

variable "lambda_role" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

variable "subnet_ids" {
  type = list(string)
}

variable "tags" {
  type = map(string)
  default = {}
}

variable "memory_size" {
  type = number
  default = 512
}

variable "timeout" {
  type = number
  default = 120
}

variable "default_log_retention_days" {
  description = "The number of days to retain logs in CloudWatch"
  type        = number
}
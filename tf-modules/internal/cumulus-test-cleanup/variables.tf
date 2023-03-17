
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

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "number of days logs will be retained for the respective cloudwatch log group, in the form of <cloudwatch_log_group_name>_log_retention"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 30
  description = "default value that user chooses for their log retention periods"
}

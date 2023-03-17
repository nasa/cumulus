variable "prefix" {
  type = string
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
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

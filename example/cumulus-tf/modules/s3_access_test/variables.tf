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
  description = "Optional retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 30
  description = "Optional default value that user chooses for their log retention periods"
}

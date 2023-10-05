variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "prefix" {
  type = string
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

variable "tea_api_url" {
  type = string
}

variable "vpc_id" {
  type        = string
  description = "VPC used by Lambda functions"
  default     = null
}

variable "deploy_to_ngap" {
  description = "Whether or not this instance of Cumulus is deployed to an NGAP environment"
  type        = bool
}

# Optional

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

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas in the form <lambda_identifier>_memory_size: <memory_size>"
  type = map(string)
  default = {
    db_migration_memory_size = 256
    tea_cache_memory_size = 256
  }
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas in the form <lambda_identifier>_timeout: <timeout>"
  type = map(string)
  default = {}
}

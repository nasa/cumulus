variable "cumulus_message_adapter_lambda_layer_version_arn" {
  description = "ARN of the Cumulus Message Adapter Lambda layer"
  type        = string
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "lambda_timeout" {
  description = "Timeout value for the Lambda function in seconds"
  type        = number
  default     = 900
}

variable "lambda_memory_size" {
  description = "Memory size for the Lambda function in MB"
  type        = number
  default     = 4096
}

variable "log_retention_days" {
  description = "The number of days to retain logs in CloudWatch"
  type        = number
}

variable "prefix" {
  type = string
}

variable "private_api_lambda_arn" {
  description = "The ARN of the private API Lambda function"
  type        = string
}

variable "security_group_id" {
  description = "Security group ID for Lambda VPC configuration"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

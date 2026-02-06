variable "prefix" {
  description = "The prefix for resource names"
  type        = string
}

variable "lambda_processing_role_arn" {
  description = "ARN of the IAM role for Lambda execution"
  type        = string
}

variable "cumulus_message_adapter_lambda_layer_version_arn" {
  description = "ARN of the Cumulus Message Adapter Lambda layer"
  type        = string
}

variable "lambda_subnet_ids" {
  description = "List of subnet IDs for Lambda VPC configuration"
  type        = list(string)
  default     = []
}

variable "lambda_security_group_id" {
  description = "Security group ID for Lambda VPC configuration"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to be applied to resources"
  type        = map(string)
  default     = {}
}

variable "lambda_timeout" {
  description = "Timeout value for the Lambda function in seconds"
  type        = number
  default     = 300
}

variable "lambda_memory_size" {
  description = "Memory size for the Lambda function in MB"
  type        = number
  default     = 512
}

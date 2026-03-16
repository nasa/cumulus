variable "prefix" {
  type        = string
}

variable "lambda_processing_role_arn" {
  description = "IAM ARN for the Lambda execution role"
  type        = string
}

variable "lambda_memory_size" {
  description = "Memory size for the Lambda function in MB"
  type        = number
  default     = 512
}

variable "lambda_timeout" {
  description = "Timeout value for the Lambda function in seconds"
  type        = number
  default     = 300
}

variable "log_retention_days" {
  description = "The number of days to retain logs in CloudWatch"
  type        = number
}

variable "lambda_security_group_id" {
  description = "Security group ID for Lambda VPC configuration"
  type        = string
  default     = ""
}

variable "lambda_subnet_ids" {
  description = "List of subnet IDs for Lambda VPC configuration"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

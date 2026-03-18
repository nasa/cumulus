# Specified in terraform.tfvars

variable "lambda_processing_role_arn" {
  description = "The ARN of the IAM role to use for the Lambda function."
  type        = string
}

variable "lambda_timeout" {
  description = "The timeout value for the Lambda function in seconds"
  type        = number
}

variable "lambda_memory_size" {
  description = "The memory size for the Lambda function in MB"
  type        = number
}

variable "security_group_id" {
    description = "Security group ID for Lambda VPC configuration."
    type        = string
    default     = ""
}

# Specified in environment variables at deploy-time
variable "prefix" {
  description = "The prefix for resource names"
  type        = string
}

variable "tags" {
  description = "A map of tags to apply to resources"
  type        = map(string)
  default     = {}
}

variable "private_api_lambda_arn" {
  description = "The ARN of the private API lambda to call in this task"
  type        = string
}

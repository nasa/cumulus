variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "lambda_timeout" {
  description = "The timeout value for the Lambda function in seconds"
  type        = number
}

variable "lambda_memory_size" {
  description = "The memory size for the Lambda function in MB"
  type        = number
}

variable "prefix" {
  type = string
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

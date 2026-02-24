variable "handler" {
  description = "The function within your code that Lambda calls to begin execution."
  type        = string
  default     = "main.lambda_handler"
}

variable "prefix" {
  description = "The prefix for resource names"
  type        = string
}

variable "role" {
  description = "ARN of the IAM role for Lambda execution"
  type        = string
}

variable "lambda_zip_path" {
  description = "Path to the Lambda deployment package zip file"
  type        = string
}

variable "name" {
  description = "A name to identify this Lambda function, used in the function name and log group name"
  type        = string
}

variable "layers" {
  description = "ARN of the Cumulus Message Adapter Lambda layer"
  type        = list(string)
  default     = []
}

variable "subnet_ids" {
  description = "List of subnet IDs for Lambda VPC configuration"
  type        = list(string)
  default     = []
}

variable "security_group_id" {
  description = "Security group ID for Lambda VPC configuration"
  type        = string
  default     = ""
}

variable "timeout" {
  description = "Timeout value for the Lambda function in seconds"
  type        = number
  default     = 900
}

variable "memory_size" {
  description = "Memory size for the Lambda function in MB"
  type        = number
  default     = 4096
}

variable "environment" {
  description = "Environment variables for the Lambda function.  This is a map that's merged with a set of defaults defined in main.tf."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Tags to be applied to resources"
  type        = map(string)
  default     = {}
}

variable "default_log_retention_days" {
  description = "The number of days to retain logs in CloudWatch"
  type        = number
}

variable "runtime" {
  description = "The runtime environment for the Lambda function (e.g., python3.13)"
  type        = string
  default     = "python3.13"
}

variable "architecture" {
  description = "The instruction set architecture for the Lambda function (e.g., x86_64 or arm64)"
  type        = string
  default     = "x86_64"
}

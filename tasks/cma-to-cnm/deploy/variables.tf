# Specified in terraform.tfvars

# We may need to use this in the future if we don't have easy access to the role arn
#variable "lambda_processing_role_pattern" {
#  description = "Regex pattern to match IAM role name when lambda_processing_role_arn is not provided"
#  type        = string
#  default     = ""
#}

variable "lambda_processing_role_arn" {
  description = "The ARN of the IAM role to use for the Lambda function."
  type        = string
}

variable "prefix" {
  type = string
}

variable "lambda_role" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

variable "subnet_ids" {
  type = list(string)
}

variable "tags" {
  type = map(string)
  default = {}
}

variable "memory_size" {
  type = number
  default = 512
}

variable "timeout" {
  type = number
  default = 120
}

variable "default_log_retention_days" {
  description = "The number of days to retain logs in CloudWatch"
  type        = number
}

# Required

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type        = string
}

variable "lambda_processing_role_arn" {
  description = "Name of IAM role assumed when executing Lambda"
  type = string
}

# Optional

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas in the form <lambda_identifier>_memory_size: <memory_size>"
  type = map(string)
  default = {
    sqs_message_remover_memory_size = 256
  }
}

variable "lambda_subnet_ids" {
  description = "Subnet IDs for Lambdas"
  type        = list(string)
  default     = null
}

variable "security_group_ids" {
  description = "Security Group IDs for Lambdas"
  type        = list(string)
  default     = null
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

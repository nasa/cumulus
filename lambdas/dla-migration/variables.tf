# Required

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type        = string
}

# Optional

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type = map(number)
  default = {}
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type = map(number)
  default = {}
}

variable "lambda_subnet_ids" {
  description = "Subnet IDs for Lambdas"
  type        = list(string)
  default     = null
}

variable "permissions_boundary_arn" {
  type    = string
  description = "Optional permissions boundary for lambda role bounds"
  default = null
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  type    = string
  default = null
}

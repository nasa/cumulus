# Required

variable "s3_replicator_source_bucket" {
  type        = string
  default     = ""
  description = "Used with the s3-replicator module."
}

variable "s3_replicator_source_prefix" {
  type        = string
  default     = ""
  description = "Used with the s3-replicator module."
}

variable "s3_replicator_target_bucket" {
  type        = string
  default     = ""
  description = "Used with the s3-replicator module."
}

variable "s3_replicator_target_prefix" {
  type        = string
  default     = ""
  description = "Used with the s3-replicator module."
}

variable "log_api_gateway_to_cloudwatch" {
  type        = bool
  default     = false
  description = "Enable logging of api gateway activity to CloudWatch."
}

variable "log_to_shared_destination" {
  type        = bool
  default     = false
  description = "Enable propagation of api-gateway and TEA EgressLambda logs to a remote destination specified by log_destination_arn - only used if log_api_gateway_to_cloudwatch is enabled."
}

variable "log_destination_arn" {
  type        = string
  default     = ""
  description = "Remote kinesis/destination arn for delivering logs - only used if log_to_shared_destination is enabled."
}

variable "prefix" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "system_bucket" {
  type = string
}

variable "urs_client_id" {
  type = string
}

variable "urs_client_password" {
  type = string
}

variable "vpc_id" {
  type = string
}

# Optional

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "protected_buckets" {
  type    = list(string)
  default = []
}

variable "public_buckets" {
  type    = list(string)
  default = []
}

variable "permissions_boundary_arn" {
  type    = string
  default = null
}

variable "distribution_url" {
  type    = string
  default = null
}

variable "aws_profile" {
  type = string
  default = null
}

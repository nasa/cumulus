# Required

variable "cmr_client_id" {
  type = string
}

variable "cmr_environment" {
  type = string
}

variable "cmr_password" {
  type = string
}

variable "cmr_provider" {
  type = string
}

variable "cmr_username" {
  type = string
}

variable "data_persistence_remote_state_config" {
  type = object({ bucket = string, key = string })
}

variable "s3_replicator_config" {
  type        = object({ source_bucket = string, source_prefix = string, target_bucket = string, target_prefix = string })
  default     = null
  description = "Configuration for the s3-replicator module. Items with prefix of source_prefix in the source_bucket will be replicated to the target_bucket with target_prefix."
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

variable "token_secret" {
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

variable "distribution_url" {
  type    = string
  default = null
}

variable "key_name" {
  type    = string
  default = null
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "private_buckets" {
  type    = list(string)
  default = []
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

variable "aws_profile" {
  type    = string
  default = null
}

variable "log_api_gateway_to_cloudwatch" {
  type        = bool
  default     = false
  description = "Enable logging of API Gateway activity to CloudWatch."
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "Remote kinesis/destination arn for delivering logs. Requires log_api_gateway_to_cloudwatch set to true."
}

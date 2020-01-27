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

variable "cumulus_message_adapter_lambda_layer_arn" {
  type = string
}

variable "cmr_oauth_provider" {
  type = string
  default = "earthdata"
}

variable "launchpad_api" {
  type = string
  default = "launchpadApi"
}

variable "launchpad_certificate" {
  type = string
  default = "launchpad.pfx"
}

variable "launchpad_passphrase" {
  type = string
  default = ""
}

variable "oauth_provider" {
  type    = string
  default = "earthdata"
}

variable "oauth_user_group" {
  type    = string
  default = "N/A"
}

variable "data_persistence_remote_state_config" {
  type = object({ bucket = string, key = string, region = string })
}

variable "s3_replicator_config" {
  type        = object({ source_bucket = string, source_prefix = string, target_bucket = string, target_prefix = string })
  default     = null
  description = "Configuration for the s3-replicator module. Items with prefix of source_prefix in the source_bucket will be replicated to the target_bucket with target_prefix."
}

variable "prefix" {
  type = string
}

variable "saml_entity_id" {
  type    = string
  default = "N/A"
}

variable "saml_assertion_consumer_service" {
  type    = string
  default = "N/A"
}

variable "saml_idp_login" {
  type    = string
  default = "N/A"
}

variable "saml_launchpad_metadata_url" {
  type    = string
  default = "N/A"
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

variable "api_gateway_stage" {
  type        = string
  default     = "dev"
  description = "The archive API Gateway stage to create"
}

variable "buckets" {
  type    = map(object({ name = string, type = string }))
  default = {}
}

variable "distribution_url" {
  type    = string
  default = null
}

variable "ems_datasource" {
  type        = string
  description = "the data source of EMS reports"
  default     = "UAT"
}

variable "ems_host" {
  type        = string
  description = "EMS host"
  default     = "change-ems-host"
}

variable "ems_path" {
  type        = string
  description = "EMS host directory path for reports"
  default     = "/"
}

variable "ems_port" {
  type        = number
  description = "EMS host port"
  default     = 22
}

variable "ems_private_key" {
  type        = string
  description = "the private key file used for sending reports to EMS"
  default     = "ems-private.pem"
}

variable "ems_provider" {
  type        = string
  description = "the provider used for sending reports to EMS"
  default     = "CUMULUS"
}

variable "ems_retention_in_days" {
  type        = number
  description = "the retention in days for reports and s3 server access logs"
  default     = 30
}

variable "ems_submit_report" {
  type        = bool
  description = "toggle whether the reports will be sent to EMS"
  default     = false
}

variable "ems_username" {
  type        = string
  description = "the username used for sending reports to EMS"
  default     = "cumulus"
}

variable "key_name" {
  type    = string
  default = null
}

variable "region" {
  type    = string
  default = "us-east-1"
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

variable "archive_api_port" {
  type    = number
  default = null
}

variable "private_archive_api_gateway" {
  type = bool
  default = true
}

variable "metrics_es_host" {
  type = string
  default = null
}

variable "metrics_es_password" {
  type = string
  default = null
}

variable "metrics_es_username" {
  type = string
  default = null
}

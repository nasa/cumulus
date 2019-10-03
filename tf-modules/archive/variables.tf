# Required

variable "background_queue_name" {
  type = string
}

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

variable "distribution_api_id" {
  type = string
}

variable "distribution_url" {
  type = string
}

variable "dynamo_tables" {
  type = map(object({ name = string, arn = string }))
}

variable "ecs_cluster_name" {
  type = string
}

variable "elasticsearch_domain_arn" {
  type = string
}

variable "elasticsearch_hostname" {
  type = string
}

variable "elasticsearch_security_group_id" {
  type = string
}

variable "ems_host" {
  type = string
}

variable "kinesis_inbound_event_logger_lambda_function_arn" {
  type = string
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "message_consumer_function_arn" {
  type = string
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "schedule_sf_function_arn" {
  type = string
}

variable "system_bucket" {
  type = string
}

variable "token_secret" {
  type = string
}

variable "urs_client_id" {
  type        = string
  description = "The URS app ID"
}

variable "urs_client_password" {
  type        = string
  description = "The URS app password"
}

# Optional

variable "api_gateway_stage" {
  type        = string
  default     = "dev"
  description = "The API Gateway stage to create"
}

variable "api_port" {
  type    = number
  default = null
}

variable "api_url" {
  type        = string
  default     = null
  description = "If not specified, the value of the API Gateway endpoint is used"
}

variable "cmr_limit" {
  type    = number
  default = 100
}

variable "cmr_oauth_provider" {
  type    = string
  default = "earthdata"
}

variable "cmr_page_size" {
  type    = number
  default = 50
}

variable "ems_datasource" {
  type    = string
  default = "UAT"
}

variable "ems_path" {
  type    = string
  default = "/"
}

variable "ems_port" {
  type    = number
  default = 22
}

variable "ems_private_key" {
  type    = string
  default = "ems-private.pem"
}

variable "ems_provider" {
  type    = string
  default = "CUMULUS"
}

variable "ems_retention_in_days" {
  type    = number
  default = 30
}

variable "ems_submit_report" {
  type    = bool
  default = false
}

variable "ems_username" {
  type    = string
  default = "cumulus"
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = null
}

variable "launchpad_api" {
  type    = string
  default = "launchpadApi"
}

variable "launchpad_certificate" {
  type    = string
  default = "launchpad.pfx"
}

variable "oauth_provider" {
  type    = string
  default = "earthdata"
}

variable "oauth_user_group" {
  type    = string
  default = "N/A"
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

variable "sts_credentials_lambda" {
  type    = string
  default = "gsfc-ngap-sh-s3-sts-get-keys"
}

variable "urs_url" {
  type        = string
  default     = "https://urs.earthdata.nasa.gov/"
  description = "The URL of the Earthdata Login site"
}

variable "users" {
  type    = list(string)
  default = []
}

variable "vpc_id" {
  type    = string
  default = null
}

# clean_executions lambda config

variable "daily_execution_payload_cleanup_schedule_expression" {
  type    = string
  default = "cron(0 4 * * ? *)"
}

variable "complete_execution_payload_timeout_disable" {
  type    = bool
  default = false
}

variable "complete_execution_payload_timeout" {
  type    = number
  default = 10
}

variable "non_complete_execution_payload_timeout_disable" {
  type    = bool
  default = false
}

variable "non_complete_execution_payload_timeout" {
  type    = number
  default = 30
}

variable "region" {
  type    = string
}
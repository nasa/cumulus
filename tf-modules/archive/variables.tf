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
  type = map(string)
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

variable "kinesis_inbound_event_logger_function_name" {
  type = string
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type = list(string)
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

variable "vpc_id" {
  type = string
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

variable "oauth_provider" {
  type    = string
  default = "earthdata"
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

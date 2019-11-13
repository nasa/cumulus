variable "buckets" {
  type    = map(object({ name = string, type = string }))
  default = {}
}

variable "cmr_oauth_provider" {
  type = string
}

variable "cmr_client_id" {
  type = string
}

variable "cmr_environment" {
  type = string
}

variable "cmr_limit" {
  type    = number
  default = 100
}

variable "cmr_page_size" {
  type    = number
  default = 50
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
  type    = string
  default = null
}

variable "distribution_url" {
  type = string
}

variable "dynamo_tables" {
  type = map(object({ name = string, arn = string }))
}

variable "enable_task_versioning" {
  type = bool
  default = false
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = null
}

variable "launchpad_api" {
  type = string
}

variable "launchpad_certificate" {
  type = string
}

variable "launchpad_passphrase" {
  type = string
  default = ""
}

variable "log2elasticsearch_lambda_function_arn" {
  type = string
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "report_executions_sns_topic_arn" {
  type = string
}

variable "report_granules_sns_topic_arn" {
  type = string
}

variable "report_pdrs_sns_topic_arn" {
  type = string
}

variable "queue_execution_limits" {
  type    = map(number)
  default = {}
}

variable "sf_start_rate" {
  type    = number
  default = null
}

variable "system_bucket" {
  type = string
}

variable "task_version" {
  type = string
  default = null
}

variable "vpc_id" {
  type    = string
  default = null
}

# Required

variable "async_operation_image" {
  description = "docker image to use for Cumulus async operations tasks"
  type = string
}

variable "background_queue_url" {
  description = "Queue URL to use for throttled background operations (e.g. granule reingest)"
  type = string
}

variable "cmr_client_id" {
  type = string
}

variable "cmr_environment" {
  type = string
}

variable "cmr_password" {
  description = "The plaintext CMR password"
  type        = string
  default     = ""
}

variable "cmr_provider" {
  type = string
}

variable "cmr_username" {
  type = string
}

variable "rds_security_group" {
  type = string
}

variable "rds_user_access_secret_arn" {
  type = string
}

variable "deploy_to_ngap" {
  description = "Whether or not this instance of Cumulus is deployed to an NGAP environment"
  type        = bool
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

variable "ecs_execution_role" {
  description = "Object containing name and ARN of IAM role for initializing ECS tasks"
  type = object({ name = string, arn = string})
}

variable "ecs_task_role" {
  description = "Object containing name and ARN of IAM role for running ECS tasks"
  type = object({ name = string, arn = string})
}

variable "elasticsearch_domain_arn" {
  type    = string
  default = null
}

variable "elasticsearch_hostname" {
  type    = string
  default = null
}

variable "elasticsearch_security_group_id" {
  type    = string
  default = ""
}

variable "elasticsearch_remove_index_alias_conflict" {
  type = bool
  default = false
  description = "Set to true to allow cumulus deployment bootstrap lambda to remove existing ES index named 'cumulus-alias' if it exists.  Setting to false will cause deployment to fail on existing index"
}

variable "kinesis_inbound_event_logger_lambda_function_arn" {
  type = string
}

variable "kinesis_fallback_topic_arn" {
  type = string
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "manual_consumer_function_arn" {
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

variable "api_reserved_concurrency" {
  type = number
  default = 8
}

variable "api_url" {
  type        = string
  default     = null
  description = "If not specified, the value of the API Gateway endpoint is used"
}

variable "buckets" {
  type    = map(object({ name = string, type = string }))
  default = {}
}

variable "cmr_custom_host" {
  description = "Custom protocol and host to use for CMR requests (e.g. http://cmr-host.com)"
  type        = string
  default     = null
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

variable "cmr_search_client_config" {
  description = "Configuration parameters for CMR search client for cumulus tasks"
  type        = map(string)
  default     = {}
}

variable "elasticsearch_client_config" {
  description = "Configuration parameters for Elasticsearch client for cumulus tasks"
  type        = map(string)
  default     = {}
}

variable "es_request_concurrency" {
  type = number
  default = 10
  description = "Maximum number of concurrent requests to send to Elasticsearch. Used in index-from-database operation"
}

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
  type    = list(string)
  default = []
}

variable "launchpad_api" {
  type    = string
  default = "launchpadApi"
}

variable "launchpad_certificate" {
  type    = string
  default = "launchpad.pfx"
}

variable "launchpad_passphrase" {
  type    = string
  default = ""
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

variable "oauth_provider" {
  type    = string
  default = "earthdata"
}

variable "oauth_user_group" {
  type    = string
  default = "N/A"
}

variable "orca_api_uri" {
  description = "ORCA API gateway URL. Excludes the resource path"
  type        = string
  default     = null
}

variable "private_archive_api_gateway" {
  type = bool
  default = true
}

variable "rds_connection_timing_configuration" {
  description = "Cumulus rds connection timeout retry timing object -- these values map to knex.js's internal use of  https://github.com/vincit/tarn.js/ for connection acquisition"
  type = map(number)
  default = {
      acquireTimeoutMillis: 90000
      createRetryIntervalMillis: 30000,
      createTimeoutMillis: 20000,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
  }
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

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

variable "urs_url" {
  type        = string
  default     = "https://uat.urs.earthdata.nasa.gov"
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

## clean_executions lambda config

variable "daily_execution_payload_cleanup_schedule_expression" {
  type    = string
  default = "cron(0 4 * * ? *)"
  description = "Cloud Watch cron schedule for the execution payload cleanup lambda"
}

variable "cleanup_running" {
  type    = bool
  default = false
  description = "Boolean flag that when set to true will enable 'running' execution cleanup"
}

variable "cleanup_non_running" {
  type    = bool
  default = true
  description = "Boolean flag that when set to true will enable non 'running' execution cleanup"
}

variable "payload_timeout" {
  type    = number
  default = 10
  description = "Number of days to retain execution payload records in the database"
}

variable "es_index" {
  type = string
  default = "cumulus"
  description = "elasticsearch index to be affected"
}

variable "update_limit" {
type = number
  default = 10000
  description = "number of executions to cleanup in one lambda run"
}

variable "log_destination_arn" {
  type = string
  default = "N/A"
  description = "A shared AWS:Log:Destination that receives logs from log_groups"
}

variable "es_index_shards" {
  description = "The number of shards for the Elasticsearch index"
  type        = number
  default     = 2
}

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 30
  description = "default value that user chooses for their log retention periods"
}
variable "report_sns_topic_subscriber_arns" {
  type = list
  default = null
  description = "Account ARNs to supply to report SNS topics policy with subscribe action"
}

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

variable "cmr_custom_host" {
  description = "Custom protocol and host to use for CMR requests (e.g. http://cmr-host.com)"
  type        = string
  default     = null
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
  description = "The unencrypted CMR password"
  type        = string
  default     = ""
}

variable "cmr_provider" {
  type = string
}

variable "cmr_username" {
  type = string
}

variable "cumulus_message_adapter_lambda_layer_version_arn" {
  description = "Layer version ARN of the Lambda layer for the Cumulus Message Adapter"
  type        = string
  default     = null
}

variable "custom_queues" {
  description = "Map of SQS queue identifiers to queue URLs"
  type    = list(object({ id = string, url = string }))
  default = []
}

variable "default_s3_multipart_chunksize_mb" {
  description = "default S3 multipart upload chunk size in MB"
  type = number
  default = 256
}

variable "allow_provider_mismatch_on_rule_filter" {
  description = "optional variable to be used in message_consumer lambdas for disabling rule/message provider mismatches"
  type = bool
  default = false
}

variable "distribution_url" {
  type = string
}

variable "dynamo_tables" {
  type = map(object({ name = string, arn = string }))
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "launchpad_api" {
  type = string
}

variable "launchpad_certificate" {
  type = string
}

variable "lzards_launchpad_certificate" {
  type = string
}

variable "launchpad_passphrase" {
  type = string
  default = ""
}

variable "lzards_launchpad_passphrase" {
  type    = string
  default = ""
}

variable "lzards_api" {
  type    = string
  default = ""
}

variable "lzards_s3_link_timeout" {
  description = "LZARDS S3 access link timeout (seconds)"
  type        = string
  default     = ""
}

variable "lzards_provider" {
  description = "LZARDS provider name"
  type        = string
  default     = ""
}

variable "orca_lambda_copy_to_archive_arn" {
  description = "AWS ARN of the ORCA copy_to_archive lambda."
  type        = string
  default     = ""
}

variable "orca_sfn_recovery_workflow_arn" {
  description = "The ARN of the recovery step function."
  type        = string
  default     = ""
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "sf_event_sqs_to_db_records_sqs_queue_url" {
  type = string
}

variable "sf_start_rate" {
  type    = number
  default = null
}

variable "system_bucket" {
  type = string
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
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

variable "throttled_queues" {
  description = "Array of configuration for custom queues with execution limits"
  type    = list(object({
    url = string,
    execution_limit = number
  }))
  default = []
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "Optional retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 30
  description = "Optional default value that user chooses for their log retention periods"
}

variable "sync_granule_s3_jitter_max_ms" {
  description = "Maximum random jitter in milliseconds to apply before S3 operations in SyncGranule task (0-59000). Set to 0 to disable jitter."
  type        = number
  default     = 0

  validation {
    condition     = var.sync_granule_s3_jitter_max_ms >= 0 && var.sync_granule_s3_jitter_max_ms <= 59000
    error_message = "sync_granule_s3_jitter_max_ms must be between 0 and 59000 milliseconds."
  }
}

variable "sqs_message_consumer_watcher_message_limit" {
  type = number
  default = 500
  description = <<EOF
    Number of messages the SQS message consumer Lambda will attempt to read from SQS in a single execution.
    Note that increasing this value may result in a direct increase/decrease in triggered workflows. Users should
    only adjust this value with the understanding of how it will impact the number of queued workflows in their
    system.
  EOF
}

variable "sqs_message_consumer_watcher_time_limit" {
  type = number
  default = 60
  description = <<EOF
    Number of seconds the SQS message consumer Lambda will remain active and polling for new messages. Note that this value
    should be less than the overall Lambda invocation timeout or else the Lambda may be terminated while still actively
    polling SQS. This value should be adjusted in conjunction with sqs_message_consumer_watcher_message_limit.
  EOF
}
variable "workflow_configurations" {
  description = <<EOF
    A general-purpose map of workflow-specific configurations.
    This object may include one or more configuration fields used to influence workflow behavior.

    - `sf_event_sqs_to_db_records_types`: An optional nested map that controls which record types
      ("execution", "granule", "pdr") should be written to the database for each workflow and
      workflow status ("running", "completed", "failed").
      This configuration is used by the `@cumulus/api/sfEventSqsToDbRecords` Lambda.

      Currently, both "execution" and "pdr" must be written to the database, so the record type list must include both.

      If this field is not provided, or if a specific workflow/status combination is not defined,
      all record types will be written to the database by default.

      Structure:
        {
          <workflow_name> = {
            <status> = [<record_type>, ...]
          }
        }

      Example:
        {
          sf_event_sqs_to_db_records_types = {
            IngestAndPublishGranule = {
              running = ["execution", "pdr"]
            }
          }
        }
  EOF

  type = object({
    sf_event_sqs_to_db_records_types = optional(map(map(list(string))), {})
  })

  default = {
    sf_event_sqs_to_db_records_types = {}
  }

  validation {
    condition = alltrue([
      for workflow in (
        var.workflow_configurations.sf_event_sqs_to_db_records_types == null
        ? []
        : keys(var.workflow_configurations.sf_event_sqs_to_db_records_types)
      ) :
      alltrue([
        for status in (
          keys(var.workflow_configurations.sf_event_sqs_to_db_records_types[workflow])
        ) :
        contains(["running", "completed", "failed"], status) &&
        alltrue([
          for required_type in ["execution", "pdr"] :
          contains(var.workflow_configurations.sf_event_sqs_to_db_records_types[workflow][status], required_type)
        ]) &&
        alltrue([
          for record_type in var.workflow_configurations.sf_event_sqs_to_db_records_types[workflow][status] :
          contains(["execution", "granule", "pdr"], record_type)
        ])
      ])
    ])
    error_message = <<EOF
Each status must be one of "running", "completed", or "failed".
Each record type list must contain both "execution" and "pdr".
Only valid record types are: "execution", "granule", "pdr".
EOF
  }
}

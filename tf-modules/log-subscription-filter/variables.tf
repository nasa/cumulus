variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "Shared AWS:Log:Destination value on where to send log groups in log_groups"
}

variable "log2elasticsearch_lambda_function_arn" {
  type = string
}

variable "logs_to_metrics" {
  type = bool
  default = false
}

# Ingest log groups
variable "discover_pdrs_task" {
  type = string
  description = "Log group for the Discover PDRs Task Lambda"
}

variable "parse_pdr_task" {
  type = string
  description = "Log group for the Parse PDRs Task Lambda"
}

variable "post_to_cmr_task" {
  type = string
  description = "Log group for the Post to CMR Task Lambda"
}

variable "queue_pdrs_task" {
  type = string
  description = "Log group for the Queue PDRs Task Lambda"
}

variable "sync_granule_task" {
  type = string
  description = "Log group for the Sync Granules Task Lambda"
}

# Async Operation Log Group
variable "async_operation_log_group" {
  type = string
  description = "Cloudwatch log group for Async Operations"
}

# Additional log groups
variable "additional_log_groups_to_elk" {
  type = map(string)
  default = {}
}

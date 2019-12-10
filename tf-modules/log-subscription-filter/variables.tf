variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "Shared AWS:Log:Destination value on where to send log groups in log_groups"
}

# Ingest log groups
variable "ingest_logs_to_elk" {
  type = bool
  default = false
}

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

# Additional log groups
variable "additional_log_groups_to_elk" {
  type = map(string)
  default = {}
}

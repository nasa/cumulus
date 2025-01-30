variable "change_granule_collection_s3_task_arn" {
  type = string
}
variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}
variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type        = string
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

variable "workflow_config" {
  description = "Cumulus module workflow configuration"
  type        = map(string)
}

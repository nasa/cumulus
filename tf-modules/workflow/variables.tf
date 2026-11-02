# Required

variable "name" {
  description = "The name for your workflow"
  type        = string
}

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}

variable "state_machine_definition" {
  description = "JSON string defining your AWS Step Function"
  type        = string
}

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type        = string
}

variable "workflow_config" {
  description = "Configuration block containing ARNs for workflow orchestration, resource roles, and integration hooks (Step Functions event SQS queue, semaphore management Lambda, IAM state machine execution role, SQS message remover Lambda, and the dedicated stack event bus name)."
  type = object({
    sf_event_sqs_to_db_records_sqs_queue_arn = string
    sf_semaphore_down_lambda_function_arn    = string
    state_machine_role_arn                   = string
    sqs_message_remover_lambda_function_arn  = string
    event_bus_name                           = string
  })
}

# Optional

variable "tags" {
  description = "Tags that should be set for the deployed resources"
  type        = map(string)
  default     = {}
}

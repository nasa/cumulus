# Required

variable "name" {
  description = "The name for your workflow"
  type = string
}

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type = string
}

variable "state_machine_definition" {
  description = "JSON string defining your AWS Step Function"
  type = string
}

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type = string
}

variable "workflow_config" {
  description = "Configuration object with ARNs for workflow integration (Role ARN for executing workflows and Lambda ARNs to trigger on workflow execution)"
  type = object({
    cw_sf_execution_event_to_db_lambda_function_arn = string
    publish_reports_lambda_function_arn = string
    sf_semaphore_down_lambda_function_arn = string
    state_machine_role_arn = string
    sqs_message_remover_lambda_function_arn = string
  })
}

# Optional

variable "tags" {
  description = "Tags that should be set for the deployed resources"
  type    = map(string)
  default = null
}

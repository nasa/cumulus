variable "name" {
  type = string
}

variable "prefix" {
  type = string
}

variable "state_machine_definition" {
  type = string
}

variable "system_bucket" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = null
}

variable "workflow_config" {
  type = object({
    publish_reports_lambda_function_arn = string
    sf_semaphore_down_lambda_function_arn = string
    state_machine_role_arn = string
  })
}

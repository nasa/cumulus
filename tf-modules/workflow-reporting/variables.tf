# Required

variable "prefix" {
  type = string
}

variable "executions_table" {
  type    = string
}

variable "granules_table" {
  type = string
}

variable "pdrs_table" {
  type = string
}

variable "state_machine_arns" {
  type        = list(string)
  description = "State machine ARNs that should trigger the report publishing Lambda"
}

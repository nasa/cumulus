# Required

variable "prefix" {
  type = string
}

variable "execution_sns_topic_arn" {
  type = string
}

variable "granule_sns_topic_arn" {
  type = string
}

variable "pdr_sns_topic_arn" {
  type = string
}

variable "state_machine_arns" {
  type        = list(string)
  description = "State machine ARNs that should trigger the report publishing Lambda"
}

# Optional

variable "permissions_boundary" {
  type    = string
  default = null
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_groups" {
  type    = list(string)
  default = []
}

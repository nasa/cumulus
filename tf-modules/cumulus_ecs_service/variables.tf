# Required

variable "cluster_arn" {
  type = string
}

variable "image" {
  type = string
}

variable "log2elasticsearch_lambda_function_arn" {
  type = string
}

variable "name" {
  description = "service name"
  type        = string
}

variable "prefix" {
  type = string
}

# Optional

variable "alarms" {
  type    = map(object({ comparison_operator = string, metric_name = string, threshold = number }))
  default = {}
}

variable "command" {
  type    = list(string)
  default = null
}

variable "cpu" {
  type    = number
  default = 10
}

variable "desired_count" {
  type    = number
  default = 0
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "memory_reservation" {
  type    = number
  default = 256
}

variable "network_mode" {
  type    = string
  default = "bridge"
}

variable "privileged" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = null
}

variable "volumes" {
  type    = list(object({ name = string, host_path = string, container_path = string }))
  default = []
}

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

variable "scaling_role_arn" {
  type = string
}

# Optional

variable "activity_arn" {
  type    = string
  default = null
}

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

variable "enable_autoscaling" {
  type    = bool
  default = false
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "max_capacity" {
  type    = number
  default = 2
}

variable "memory_reservation" {
  type    = number
  default = 256
}

variable "min_capacity" {
  type    = number
  default = 1
}

variable "network_mode" {
  type    = string
  default = "bridge"
}

variable "privileged" {
  type    = bool
  default = false
}

variable "scale_in_activity_schedule_time" {
  type    = number
  default = 5000
}

variable "scale_in_adjustment_percent" {
  type    = number
  default = -5
}

variable "scale_out_adjustment_percent" {
  type    = number
  default = 10
}

variable "scale_out_activity_schedule_time" {
  type    = number
  default = 10000
}

variable "tags" {
  type    = map(string)
  default = null
}

variable "volumes" {
  type    = list(object({ name = string, host_path = string, container_path = string }))
  default = []
}

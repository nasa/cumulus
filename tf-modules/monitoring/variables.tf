# Required

variable "prefix" {
  type = string
}

# Optional

variable "elasticsearch_alarms" {
  type = list(object({ name = string, arn = string }))
  default = []
}

variable "ecs_service_alarms" {
  type = list(object({ name = string, arn = string }))
  default = []
}

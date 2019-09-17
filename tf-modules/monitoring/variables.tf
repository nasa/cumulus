# Required

variable "prefix" {
  type = string
}

# Optional

variable "elasticsearch_alarms" {
  type = list
  default = []
}

variable "ecs_service_alarms" {
  type = list
  default = []
}

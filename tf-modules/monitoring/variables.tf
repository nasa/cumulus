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

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

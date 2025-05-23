# Required

variable "prefix" {
  type = string
}

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type        = string
}

# Optional

variable "ecs_service_alarms" {
  type = list(object({ name = string, arn = string }))
  default = []
}

variable "prefix" {
  description = "The prefix for resource names"
  type        = string
}

variable "cumulus_ecs_cluster_arn" {
  description = "ARN of the Cumulus ECS cluster"
  type        = string
}

variable "cumulus_process_activity_version" {
    description = "Docker image version to use for this service"
    type        = string
}

variable "tags" {
  description = "Tags to be applied to resources"
  type        = map(string)
  default     = {}
}

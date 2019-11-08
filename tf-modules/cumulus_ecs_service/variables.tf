# Required

variable "cluster_arn" {
  description = "ARN of an ECS cluster"
  type = string
}

variable "image" {
  description = "Image used to start the container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
  type = string
}

variable "log2elasticsearch_lambda_function_arn" {
  description = "ARN of log2elasticsearch Lambda"
  type = string
}

variable "name" {
  description = "ECS service name"
  type        = string
}

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type = string
}

# Optional

variable "alarms" {
  description = "Configuration for Cloudwatch alarms to monitor ECS, keyed by alarm name"
  type    = map(object({ comparison_operator = string, metric_name = string, threshold = number }))
  default = {}
}

variable "command" {
  description = "The command that is passed to the ECS container. Command is concatenated from a list of strings."
  type    = list(string)
  default = null
}

variable "cpu" {
  description = "The number of CPU units the Amazon ECS container agent will reserve for the container"
  type    = number
  default = 10
}

variable "desired_count" {
  description = "Desired count of ECS cluster instances"
  type    = number
  default = 0
}

variable "environment" {
  description = "Environment variables to pass to the ECS container"
  type    = map(string)
  default = {}
}

variable "memory_reservation" {
  description = "The soft limit (in MB) of memory to reserve for the container"
  type    = number
  default = 256
}

variable "network_mode" {
  description = "The Docker networking mode to use for the containers in the task"
  type    = string
  default = "bridge"
}

variable "privileged" {
  description = "When this parameter is true, the container is given elevated privileges on the host container instance (similar to the root user)."
  type    = bool
  default = false
}

variable "tags" {
  description = "Tags to apply to deployed resources"
  type    = map(string)
  default = null
}

variable "volumes" {
  description = "Volumes to make accessible to the container(s)"
  type    = list(object({ name = string, host_path = string, container_path = string }))
  default = []
}

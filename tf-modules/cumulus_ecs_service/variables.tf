# Required

variable "cluster_arn" {
  description = "ARN of an ECS cluster"
  type = string
}

variable "image" {
  description = "Image used to start the container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
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

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 30
  description = "default value that user chooses for their log retention periods"
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
  default = {}
}

variable "volumes" {
  description = "Volumes to make accessible to the container(s)"
  type    = list(object({ name = string, host_path = string, container_path = string }))
  default = []
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "A shared AWS:Log:Destination that receives logs in log_groups"
}

variable "health_check" {
  description = "Health check used by AWS ECS to determine containers health status. See https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#container_definition_healthcheck"
  type = object({
    command     = list(string)
    interval    = number
    timeout     = number
    retries     = number
    startPeriod = number
  })
  default = null
}

variable "force_new_deployment" {
  description = "Enable to force a new task deployment of the service. See https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service#force_new_deployment"
  type = bool
  default = false
}

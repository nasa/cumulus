# Required
variable "cluster_name" {
  description = "Name of an ECS cluster"
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

variable "fargate_scaling_cooldown" {
  type = number
  default = 300
}

variable "fargate_upscale_adjustment" {
  type = number
  default = 20
}

variable "fargate_downscale_adjustment" {
  type = number
  default = -20
}

variable "fargate_scaling_adjustment_period" {
  type = number
  default = 300
}

variable "fargate_scheduled_task_threshold" {
  type = number
  default = 10
}
variable "fargate_max_capacity" {
  type = number
  default =  2
}

variable "fargate_min_capacity" {
  type = number
  default = 0
}

variable "subnet_ids" {
  description = "Subnet IDs for fargate tasks"
  type        = list(string)
  default     = null
}
variable "use_fargate" {
  description = "true/false if the task should use Fargate.  False will use EC2"
  type = bool
  default = false
}

variable "execution_role_arn" {
  description = "execution role ARN to execution the service tasks as a service"
  type = string
  default = null
}

variable "task_role_arn" {
  description = "task role ARN to execution the service tasks as a service"
  type = string
  default = null
}
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

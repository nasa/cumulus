# Required

variable "cmr_client_id" {
  type = string
}

variable "cmr_environment" {
  type = string
}

variable "cmr_password" {
  type = string
}

variable "cmr_provider" {
  type = string
}

variable "cmr_username" {
  type = string
}

variable "cumulus_message_adapter_lambda_layer_arn" {
  type    = string
  default = null
}

variable "dynamo_tables" {
  type = map(object({ name = string, arn = string }))
}

variable "ecs_cluster_desired_size" {
  type = number
}

variable "ecs_cluster_instance_subnet_ids" {
  type = list(string)
}

variable "ecs_cluster_max_size" {
  type = number
}

variable "ecs_cluster_min_size" {
  type = number
}

variable "elasticsearch_domain_arn" {
  type = string
}

variable "elasticsearch_hostname" {
  type = string
}

variable "elasticsearch_security_group_id" {
  type = string
}

variable "prefix" {
  type = string
}

variable "sts_credentials_lambda_function_arn" {
  type = string
}

variable "system_bucket" {
  type = string
}

variable "token_secret" {
  type = string
}

variable "urs_client_id" {
  type        = string
  description = "The URS app ID"
}

variable "urs_client_password" {
  type        = string
  description = "The URS app password"
}

# Optional

variable "archive_api_port" {
  type    = number
  default = null
}

variable "archive_api_users" {
  type    = list(string)
  default = []
}

variable "buckets" {
  type    = map(object({ name = string, type = string }))
  default = {}
}

variable "cmr_limit" {
  type    = number
  default = 100
}

variable "cmr_oauth_provider" {
  type    = string
  default = "earthdata"
}

variable "cmr_page_size" {
  type    = number
  default = 50
}

variable "distribution_url" {
  type    = string
  default = null
}

variable "ecs_container_stop_timeout" {
  type    = string
  default = "2m"
}

variable "ecs_cluster_instance_docker_volume_size" {
  type        = number
  description = "Size (in GB) of the volume that Docker uses for image and metadata storage"
  default     = 50
}

variable "ecs_cluster_instance_image_id" {
  type        = string
  description = "AMI ID of ECS instances"
  default     = "ami-03e7dd4efa9b91eda"
}

variable "ecs_cluster_instance_type" {
  type        = "string"
  description = "EC2 instance type for cluster instances"
  default     = "t2.medium"
}

variable "ecs_cluster_scale_in_adjustment_percent" {
  type    = number
  default = -5
}

variable "ecs_cluster_scale_in_threshold_percent" {
  type    = number
  default = 25
}

variable "ecs_cluster_scale_out_adjustment_percent" {
  type    = number
  default = 10
}

variable "ecs_cluster_scale_out_threshold_percent" {
  type    = number
  default = 75
}

variable "ecs_docker_hub_config" {
  type    = object({ username = string, password = string, email = string })
  default = null
}

variable "ecs_docker_storage_driver" {
  type    = string
  default = "overlay2"
}

variable "ecs_efs_config" {
  type    = object({ mount_target_id = string, mount_point = string })
  default = null
}

variable "key_name" {
  type    = string
  default = null
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = null
}

variable "launchpad_api" {
  type    = string
  default = "launchpadApi"
}

variable "launchpad_certificate" {
  type    = string
  default = "launchpad.pfx"
}

variable "oauth_provider" {
  type    = string
  default = "earthdata"
}

variable "oauth_user_group" {
  type    = string
  default = "N/A"
}

variable "permissions_boundary_arn" {
  type    = string
  default = null
}

variable "queue_execution_limits" {
  type = map(number)
  default = {
    backgroundProcessing = 5
  }
}

variable "urs_url" {
  type        = string
  default     = "https://urs.earthdata.nasa.gov/"
  description = "The URL of the Earthdata Login site"
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "region" {
  type    = string
}
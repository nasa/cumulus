variable "aws_profile" {
  type    = string
  default = null
}

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}

variable "aws_db_subnet_group_prefix" {
  description = "Prefix for RDS database cluster subnet group"
  type        = string
  default     = "cumulus-rds-tf-subnet"
}

variable "rds_endpoint" {
  description = "The rw endpoint for RDS"
  type        = string
}

variable "db_admin_username" {
  description = "Username for RDS database administrator authentication"
  type        = string
  default     = "postgres"
}

variable "db_admin_password" {
  description = "Password for RDS database administrator authentication"
  type = string
}

variable "region" {
  description = "Region to deploy module to"
  type        = string
  default     = "us-east-1"
}

variable "subnets" {
  description = "Subnets for database cluster.  Requires at least 2 across multiple AZs"
  type    = list(string)
}

variable "tags" {
  description = "Tags to be applied to RDS cluster resources that support tags"
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  description = "VPC ID for the Cumulus Deployment"
  type        = string
}

variable "force_new_deployment" {
  description = "Enable to force a new task deployment of the service. See https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service#force_new_deployment"
  type = bool
  default = false
}

variable "cpu" {
  description = "The number of CPU units the Amazon ECS container agent will reserve for the task"
  type    = number
  default = 4096 # 4 CPUs
}

variable "cpu_architecture" {
  description = "The architecture of the cpu platform. Valid values are X86_65 and ARM64"
  type        = string
  default     = "ARM64"
}

variable "memory" {
  description = "The memory the ECS container agent will reserve for the task"
  type        = number
  default     = 16384 # 16GB
}

variable "volume_size_in_gb" {
  description = "Size in GB of the volume mount used to serialize kafka messages"
  type        = number
  default     = 20
}

variable "kafka_image" {
  description = "Image used to start kafka the container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
  type = string
  default = "quay.io/debezium/kafka:3.4"
}

variable "connect_image" {
  description = "Image used to start kafka the container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
  type = string
  default = "quay.io/debezium/connect:3.4"
}

variable "data_persistence_remote_state_config" {
  type = object({ bucket = string, key = string, region = string })
}

variable "rds_cluster_remote_state_config" {
  type = object({ bucket = string, key = string, region = string })
}

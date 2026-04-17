variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}

variable "region" {
  description = "Region to deploy module to"
  type        = string
  default     = "us-east-1"
}

variable "rds_security_group" {
  description = "RDS access security group"
  type        = string
}

variable "task_security_group_id" {
  description = "Security group to use for tasks"
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

variable "rds_port" {
  description = "The Postgres port"
  type        = string
  default     = "5432"
}

variable "db_admin_username" {
  description = "Username for RDS database administrator authentication"
  type        = string
  default     = "postgres"
}

variable "db_admin_password" {
  description = "Password for RDS database administrator authentication"
  type        = string
}

variable "subnet" {
  description = "Subnet for Fargate tasks. We only use one since we are using EBS volumes which don't work across multiple AZs."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the Cumulus Deployment"
  type        = string
}

variable "force_new_deployment" {
  description = "Enable to force a new task deployment of the service. See https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service#force_new_deployment"
  type        = bool
  default     = false
}

variable "cpu" {
  description = "The number of CPU units the Amazon ECS container agent will reserve for the task"
  type        = number
  default     = 4096 # 4 CPUs
}

variable "cpu_architecture" {
  description = "The architecture of the cpu platform. Valid values are X86_65 and ARM64"
  type        = string
  default     = "ARM64"
}

variable "memory" {
  description = "The amount of memory (in MB) that the ECS container agent reserves for a task."
  type        = number
  default     = 16384 # 16GB
}

variable "volume_size_in_gb" {
  description = "Size in GB of the volume mount used to serialize kafka messages"
  type        = number
  default     = 20
}

variable "kafka_image" {
  description = "Image used to start the kafka container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
  type        = string
}

variable "connect_image" {
  description = "Image used to start the kafka-connect container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
  type        = string
}

variable "bootstrap_image" {
  description = "Image used to start the bootstrap container. See https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html#ECS-Type-ContainerDefinition-image"
  type        = string
}

variable "tags" {
  description = "Tags to be applied to RDS cluster resources that support tags"
  type        = map(string)
  default     = {}
}

variable "slot_name" {
  description = "The name of the Postgres replication slot to be used to track changes in the dB. This will be created by the source connector if it does not exist."
  type        = string
}

variable "table_include_list" {
  description = "comma-separated list of dB tables to be replicated"
  type        = string
}

variable "column_exclude_list" {
  description = "Comma separated list of database columns that should not be replicated"
  default     = ""
  type        = string
}

variable "iceberg_s3_bucket" {
  description = "S3 bucket where iceberg tables are stored"
  type        = string
}

variable "iceberg_namespace" {
  description = "iceberg namespace (same as glue database)"
  type        = string
}

variable "pg_db" {
  description = "postgres database"
  type = string
}

variable "pg_schema" {
  description = "The name of the schema in the postgres database that contains the tables"
  type = string
  default = "public"
}

variable "ecs_infrastructure_role" {
  description = "IAM role used to provide access to EBS volumes"
  type = object({
    arn  = string
    name = string
  })
}

variable "fargate_task_role" {
  description = "IAM role used to allow task containers to access AWS services"
  type = object({
    arn  = string
    name = string
  })
}

variable "ecs_task_execution_role" {
  description = "IAM role used by Docker daemon and ECS container agent"
  type = object({
    arn  = string
    name = string
  })
}

variable "ecs_cluster" {
  description = "The ECS cluster to which the replication service will belong"
  type = object({
    arn  = string
    name = string
    id   = string
  })
}

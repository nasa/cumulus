variable "aws_profile" {
  type    = string
  default = null
}

variable "db_admin_username" {
  description = "Username for RDS database authentication"
  type = string
}

variable "db_admin_password" {
  description = "Password for RDS database authentication"
  type = string
}

variable "region" {
  description = "Region to deploy to"
  type        = string
  default     = "us-east-1"
}

variable "prefix" {
  type = string
  description = "'prefix' for the deployment ecosystem (Core deployment, data persistence deployment, etc)"
}

variable "vpc_id" {
  description = "VPC ID for the Cumulus Deployment"
  type        = string
  default = null
}

variable "subnets" {
  description = "Subnets for database cluster.  Requires at least 2 across multiple AZs"
  type    = list(string)
  default = null
}

variable "deletion_protection" {
  description = "Flag to prevent terraform from making changes that delete the database in CI"
  type        = bool
  default     = true
}

variable "cluster_identifier" {
  description = "DB identifier for the RDS cluster that will be created"
  type        = string
  default     = "cumulus-rds-serverless-default-cluster"
}

variable "snapshot_identifier" {
  description = "Optional database snapshot for restoration"
  type = string
  default = null
}

variable "tags" {
  description = "Tags to be applied to RDS cluster resources that support tags"
  type        = map(string)
  default     = {}
}

variable "engine_version" {
  description = "Postgres engine version for Serverless cluster"
  type        = string
  default     = "10.12"
}

variable "vpc_tag_name" {
  description = "Tag name to use for looking up VPC"
  type = string
  default = "Application VPC"
}

variable "subnets_tag_name" {
  description = "Tag name to use for looking up VPC subnets"
  type = string
  default = "Private application *"
}


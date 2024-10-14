
variable "aws_db_subnet_group_prefix" {
  description = "Prefix for RDS database cluster subnet group"
  type        = string
  default     = "cumulus-rds-tf-subnet"
}

variable "apply_immediately" {
  description = "If true, RDS will apply updates to cluster immediately, instead of in the maintenance window"
  type        = bool
  default     = true
}

variable "backup_retention_period" {
  description = "Number of backup periods to retain"
  type        = number
  default     = 1
}

variable "backup_window" {
  description = "Preferred database backup window (UTC)"
  type        = string
  default     = "07:00-09:00"
}

variable "deletion_protection" {
  description = "Flag to prevent terraform from making changes that delete the database in CI"
  type        = bool
  default     = true
}

variable "cluster_identifier" {
  description = "DB Itentifier for the RDS cluster that will be created"
  type        = string
  default     = "cumulus-rds-serverless-default-cluster"
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

variable "profile" {
  description = "AWS profile to use for authentication"
  type        = string
  default     = null
}

variable "region" {
  description = "Region to deploy module to"
  type        = string
  default     = "us-east-1"
}

variable "security_group_name" {
  description = "Name for RDS access security group"
  type        = string
  default     = "cumulus_rds_cluster_acess_ingress"
}

variable "snapshot_identifier" {
  description = "Snapshot identifer for restore"
  default     = null
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

variable "engine_version" {
  description = "Postgres engine version for serverless cluster"
  type        = string
  default     = "13.12"
}

variable "parameter_group_family_v13" {
  description = "Database family to use for creating database parameter group under postgres 13 upgrade conditions"
  type = string
  default = "aurora-postgresql13"
}

variable "max_capacity" {
  type = number
  default = 4
}

variable "min_capacity" {
  type = number
  default = 2
}

variable "cluster_instance_count" {
  description = "Number of instances to create inside of the cluster"
  type = number
  default = 1
  validation {
    condition = var.cluster_instance_count >= 1 && var.cluster_instance_count <= 16
    error_message = "Variable cluster_instance_count should be between 1 and 16."
  }
}

### Required for user/database provisioning
variable "prefix" {
  type = string
}
variable "provision_user_database" {
  description = "true/false flag to configure if the module should provision a user and database using default settings"
  type = bool
  default = false
}

variable "permissions_boundary_arn" {
  type    = string
  default = ""
}

variable "rds_user_password" {
  type    = string
  default = ""
}

variable "rds_connection_timing_configuration" {
  description = "Cumulus rds connection timeout retry timing object -- these values map to knex.js's internal use of  https://github.com/vincit/tarn.js/ for connection acquisition"
  type = map(number)
  default = {
      acquireTimeoutMillis: 90000
      createRetryIntervalMillis: 30000,
      createTimeoutMillis: 20000,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
  }
}

variable "rds_scaling_timeout_action" {
  description = "Action to take when RDS cluster cannot find a scaling point after given timeout"
  type = string
  default = "ForceApplyCapacityChange"
}

variable "db_parameters" {
  type = list(object({
    name = string,
    value = string,
    apply_method = string
  }))
  default = [
    {
      name  = "shared_preload_libraries"
      value = "pg_stat_statements,auto_explain"
      apply_method = "pending-reboot"
    },
    {
      name         = "rds.force_ssl"
      value        = 0
      apply_method = "pending-reboot"
    }
  ]
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type = map(number)
  default = {}
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type = map(number)
  default = {}
}

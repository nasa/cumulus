# Required

variable "prefix" {
  description = "prefix to use for naming created resources"
  type        = string
}

variable "permissions_boundary_arn" {
  type = string
}

# Optional

variable "custom_domain_name" {
  description = "Custom domain name for Elasticsearch"
  type        = string
  default     = null
}

variable "elasticsearch_config" {
  description = "Configuration object for Elasticsearch"
  type = object({
    domain_name    = string
    instance_count = number
    instance_type  = string
    version        = string
    volume_size    = number
  })
  default = {
    domain_name    = "es"
    instance_count = 1
    instance_type  = "t2.small.elasticsearch"
    version        = "5.3"
    volume_size    = 10
  }
}

variable "enable_point_in_time_tables" {
  description = "DynamoDB table names that should have point in time recovery enabled"
  type        = list(string)
  default = [
    "CollectionsTable",
    "ExecutionsTable",
    "FilesTable",
    "GranulesTable",
    "PdrsTable",
    "ProvidersTable",
    "RulesTable",
    "UsersTable"
  ]
}

variable "es_trusted_role_arns" {
  description = "IAM role ARNs that should be trusted for connecting to Elasticsearch"
  type        = list(string)
  default     = []
}

variable "include_elasticsearch" {
  description = "True/false for whether to deploy Elasticsearch"
  type        = bool
  default     = true
}

variable "subnet_ids" {
  description = "Subnet IDs that should be used when deploying Elasticsearch/using a Postgres database inside of a VPC"
  type        = list(string)
  default     = []
}

variable "elasticsearch_security_group_ids" {
  description = "Security Group IDs to assign to the Elasticsearch domain"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

variable "rds_user_access_secret_arn" {
  description = "AWS Secrets Manager secret ARN containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type = string
}

variable "rds_security_group_id" {
  type = string
  default = ""
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "db_migration_lambda_timeout" {
  description = "Timeout in seconds for the database schema migration lambda.   Defaults to 900 seconds"
  type = number
  default = 900
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

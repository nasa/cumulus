# Required

variable "permissions_boundary_arn" {
  type    = string
}

variable "prefix" {
  type = string
}

variable "rds_admin_access_secret_arn" {
  description = "AWS Secrets Manager secret ARN containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type        = string
}

variable "rds_security_group" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
  default = null
}

variable "vpc_id" {
  type = string
  default = null
}

# Optional

variable "aws_region" {
  type    = string
  default = "us-east-1"
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
  default     = []
}

variable "rds_user_password" {
  description = "Password to set for RDS db user"
  type = string
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

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

variable "vpc_tag_name" {
  description = "Tag name to use for looking up VPC"
  type = string
  default = "Application VPC"
}

variable "subnets_tag_name" {
  description = "Tag name to use for looking up VPC subnets"
  type = string
  default = "Private application us-east-1a *"
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type = map(number)
  default = {
    ProvisionPostgresDatabase = 384 # data-persistence
  }
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type = map(number)
  default = {
    ProvisionPostgresDatabase = 600 # data-persistence
  }
}

# Required

variable "prefix" {
  description = "prefix to use for naming created resources"
  type        = string
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
  description = "Subnet IDs (for Elasticsearch)"
  type        = list(string)
  default     = []
}

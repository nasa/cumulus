# Required

variable "prefix" {
  type    = string
}

variable "es_trusted_role_arns" {
  type    = list(string)
}

# Optional

variable "create_service_linked_role" {
  type = bool
  default = true
}

variable "include_elasticsearch" {
  type    = bool
  default = true
}

variable "elasticsearch_config" {
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
  type    = list(string)
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

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_groups" {
  type    = list(string)
  default = []
}

variable "vpc_id" {
  type    = string
  default = null
}

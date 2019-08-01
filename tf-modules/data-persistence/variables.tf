# Required

variable "prefix" {
  type    = string
}

# Optional

variable "include_elasticsearch" {
  type    = bool
  default = true
}

variable "elasticsearch_config" {
  type = object({
    domain_name = string
    instance_type = string
    version = string
    volume_size = number
  })
  default = {
    domain_name = "es"
    instance_type = "t2.small.elasticsearch"
    version = "5.3"
    volume_size = 5
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

variable "es_role_arns" {
  type    = list(string)
  default = []
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
  default = ""
}

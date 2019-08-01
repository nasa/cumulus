# Required

variable "prefix" {
  type    = string
}

# Optional

variable "elasticsearch_config" {
  type    = object({
    domain_name = string
    instance_type = string
    version = string
  })
  default = {
    domain_name = null
    instance_type = "t2.small.elasticsearch"
    version = "5.3"
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
  default = ""
}

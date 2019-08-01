# Required

variable "prefix" {
  type    = string
}

# Optional

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

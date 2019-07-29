
variable "prefix" {
  type = string
}

variable "aws_profile" {
  type    = string
  default = "default"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "permissions_boundary" {
  type = string
}

variable "vpc_id" {
  type    = string
  default = ""
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_groups" {
  type    = list(string)
  default = []
}

variable "table_names" {
  type    = list(string)
  default = [
    "AccessTokensTable",
    "AsyncOperationsTable",
    "CollectionsTable",
    "ExecutionsTable",
    "FilesTable",
    "GranulesTable",
    "PdrsTable",
    "ProvidersTable",
    "RulesTable",
    "SemaphoresTable",
    "UsersTable"
  ]
}

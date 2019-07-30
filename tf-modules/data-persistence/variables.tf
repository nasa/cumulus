# Required

variable "prefix" {
  type    = string
}

# Optional

variable "aws_profile" {
  type    = string
  default = "default"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "enable_point_in_time_recovery" {
  type    = bool
  default = false
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

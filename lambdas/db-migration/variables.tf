variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "rds_user_access_secret_arn" {
  description = "AWS Secrets Manager secret ARN containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type = string
}

variable "rds_security_group_id" {
  type = string
  default = ""
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas in the form <lambda_identifier>_timeout: <timeout>"
  type = map(string)
  default = {}
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas in the form <lambda_identifier>_memory_size: <memory_size>"
  type = map(string)
  default = {}
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "vpc_id" {
  type    = string
  default = null
}

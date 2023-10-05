variable "rds_security_group" {
  type = string
  description = "Security group that allow access to the db cluster"
}

variable "vpc_id" {
  type = string
  description = "The VPC the deployment is in"
}

variable "prefix" {
  type = string
  description = "'prefix' for the deployment ecosystem (Core deployment, data persistence deployment, etc)"
}

variable "subnet_ids" {
  type = list(string)
  description = "Subnets to assign to the database provisioning lambda"
}

variable "rds_user_password" {
  description = "Password to set for RDS db user"
  type = string
}

variable "rds_admin_access_secret_arn" {
  description = "AWS Secrets Manager secret arn containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type = string
}

variable "rds_connection_timing_configuration" {
  description = "Cumulus rds connection timeout retry timing object -- these values map to knex.js's internal use of  https://github.com/vincit/tarn.js/ for connection acquisition"
  type = map(number)
  default = {
      acquireTimeoutMillis: 400000
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

variable "permissions_boundary_arn" {
  type    = string
  description = "Optional permissions boundary for lambda role bounds"
  default = null
}

variable "dbRecreation" {
  type        = bool
  description = "**Warning** Data loss will occur if set to 'true'. Boolean flag to set user database to be wiped and recreated on provision for each deploy"
  default     = false
}

# Optional 

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas in the form <lambda_identifier>_memory_size: <memory_size>"
  type = map(string)
  default = {
    provision_database_memory_size = 256
  }
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas in the form <lambda_identifier>_timeout: <timeout>"
  type = map(string)
  default = {}
}

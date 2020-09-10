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

variable "rds_connection_heartbeat" {
  description = "Sets if Core database code should send a query to verify db connection on creation/rety on connection timeout.  Disable if not using serverless"
  type    = bool
  default = true
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

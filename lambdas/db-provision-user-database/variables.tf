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

variable "rds_admin_access_secret_id" {
  description = "AWS Secrets Manager secret ID containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type = string
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

# Required

variable "lambda_processing_role_arn" {
  type        = string
  description = "Cumulus lambda processing role"
}

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "system_bucket" {
  type        = string
  description = "A bucket to be used for staging deployment files"
}

variable "tea_internal_api_endpoint" {
  description = "Thin Egress App internal endpoint URL"
  type        = string
}

# Optional

variable "permissions_boundary_arn" {
  type        = string
  default     = null
  description = "The ARN of an IAM permissions boundary to use when creating IAM policies"
}

variable "protected_buckets" {
  type        = list(string)
  default     = []
  description = "A list of protected buckets"
}

variable "public_buckets" {
  type        = list(string)
  default     = []
  description = "A list of public buckets"
}

variable "lambda_subnet_ids" {
  type        = list(string)
  description = "VPC subnets used by Lambda functions"
  default     = null
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  type        = string
  description = "VPC used by Lambda functions"
  default     = null
}

variable "deploy_to_ngap" {
  description = "Whether or not this instance of Cumulus is deployed to an NGAP environment"
  type        = bool
}

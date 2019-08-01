# Required

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "subnet_ids" {
  type        = list(string)
  description = "VPC subnets used by Lambda functions"
}

variable "system_bucket" {
  type        = string
  description = "A bucket to be used for staging deployment files"
}

variable "urs_client_id" {
  type        = string
  description = "The URS app ID"
}

variable "urs_client_password" {
  type        = string
  description = "The URS app password"
}

variable "vpc_id" {
  type        = string
  description = "VPC used by Lambda functions"
}

# Optional

variable "api_gateway_stage" {
  type        = string
  default     = "DEV"
  description = "The API Gateway stage to create"
}

variable "distribution_url" {
  type        = string
  default     = null
  description = "An alternative URL used for distribution"
}

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

variable "region" {
  type        = string
  default     = "us-east-1"
  description = "The AWS region to deploy to"
}

variable "sts_credentials_lambda_name" {
  type    = string
  default = "gsfc-ngap-sh-s3-sts-get-keys"
}

variable "urs_url" {
  type        = string
  default     = "https://urs.earthdata.nasa.gov"
  description = "The URL of the Earthdata Login site"
}

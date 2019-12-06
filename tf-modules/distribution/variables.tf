# Required

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
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

# Optional

variable "api_gateway_stage" {
  type        = string
  default     = "DEV"
  description = "The API Gateway stage to create"
}

variable "deploy_s3_credentials_endpoint" {
  type    = bool
  default = true
}

variable "distribution_url" {
  type        = string
  default     = null
  description = "An alternative URL used for distribution"
}

variable "log_api_gateway_to_cloudwatch" {
  type        = bool
  default     = false
  description = "Boolean switch to enable/disable logging of API Gateway distribution traffic to CloudWatch."
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "shared AWS:Log:Destination value. Requires log_api_gateway_to_cloudwatch set to true."
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

variable "sts_credentials_lambda_function_arn" {
  type = string
  default = null
}

variable "subnet_ids" {
  type        = list(string)
  description = "VPC subnets used by Lambda functions"
  default     = null
}

variable "urs_url" {
  type        = string
  default     = "https://urs.earthdata.nasa.gov"
  description = "The URL of the Earthdata Login site"
}

variable "vpc_id" {
  type        = string
  description = "VPC used by Lambda functions"
  default     = null
}

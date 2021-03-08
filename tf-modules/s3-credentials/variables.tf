# Required

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "sts_credentials_lambda_function_arn" {
  type    = string
}

variable "api_gateway_stage" {
  type        = string
  default     = null
  description = "The API Gateway stage name for attaching the /s3credentials endpoint"
}

variable "external_api_endpoint" {
  description = "Public-facing API host used for requesting /s3credentials endpoint"
  type        = string
}

variable "rest_api_id" {
  description = "API gateway ID to use for attaching /s3credentials endpoint"
  type        = string
}

variable "rest_api_root_resource_id" {
  description = "API gateway root resource ID to use for attaching /s3credentials endpoint"
  type        = string
}

variable "urs_client_id" {
  type        = string
  description = "The client ID for your Earthdata login (URS) application"
}

variable "urs_client_password" {
  type        = string
  description = "The client password for your Earthdata login (URS) application"
}

variable "urs_url" {
  type        = string
  default     = "https://urs.earthdata.nasa.gov"
  description = "The URL of the Earthdata Login site"
}

# Optional

variable "permissions_boundary_arn" {
  type        = string
  default     = null
  description = "The ARN of an IAM permissions boundary to use when creating IAM policies"
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

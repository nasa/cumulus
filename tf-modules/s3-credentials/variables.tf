# Required

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "sts_credentials_lambda_function_arn" {
  type    = string
}

variable "tea_api_gateway_stage" {
  type        = string
  default     = null
  description = "The API Gateway stage name for the Thin Egress App"
}

variable "tea_external_api_endpoint" {
  description = "Thin Egress App external endpoint URL"
  type        = string
}

variable "tea_rest_api_id" {
  description = "Thin Egress App API gateway ID"
  type        = string
}

variable "tea_rest_api_root_resource_id" {
  description = "Thin Egress App API gateway root resource ID"
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

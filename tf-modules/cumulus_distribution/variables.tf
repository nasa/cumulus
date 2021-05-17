variable "deploy_to_ngap" {
  description = "Whether or not this instance of Cumulus is deployed to an NGAP environment"
  type        = bool
}

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "oauth_client_id" {
  type        = string
  description = "oauth_client_id"
}

variable "oauth_client_password" {
  type        = string
  description = "oauth_client_password"
}

variable "oauth_host_url" {
  type        = string
  description = "oauth_host_url"
}

variable "token_secret" {
  description = "A string value used for signing and verifying JSON Web Tokens (JWTs) issued by the API. Should be a 32-character string for security"
  type        = string
}

# Optional

variable "api_url" {
  type        = string
  default     = null
  description = "If not specified, the value of the API Gateway endpoint is used"
}

variable "api_gateway_stage" {
  type        = string
  default     = "dev"
  description = "The API Gateway stage name for the distribution App"
}

variable "jwt_cookiename" {
  type        = string
  default     = "cumulus_distribution_oauth"
  description = "The JWT cookie's name is set with the 'JWT_COOKIENAME' env variable"
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

variable "oauth_provider" {
  type        = string
  default     = "cognito"
  description = "The OAuth provider, cognito or earthdata"
}

variable "permissions_boundary_arn" {
  type        = string
  default     = null
  description = "The ARN of an IAM permissions boundary to use when creating IAM policies"
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

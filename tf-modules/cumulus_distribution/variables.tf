variable "deploy_to_ngap" {
  description = "Whether or not this instance of Cumulus is deployed to an NGAP environment"
  type        = bool
}

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
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

variable "cmr_acl_based_credentials" {
  type = bool
  default = false
  description = "Option to enable/disable user based CMR ACLs to derive permission for s3 credential access tokens"
}

variable "cmr_environment" {
  description = "The CMR environment to access"
  type        = string
  default     = null
}

variable "cmr_provider" {
  description = "The provider used to search CMR ACLs"
  type        = string
  default     = null
}

variable "deploy_s3_credentials_endpoint" {
  type         = bool
  default      = true
  description  = "Option to deploy the s3 credentials endpoint."
}

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
}

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

variable "sts_credentials_lambda_function_arn" {
  type        = string
  default     = null
  description = "ARN of lambda function that provides app owners with keys that can be passed on to their app users."
}

variable "sts_policy_helper_lambda_function_arn" {
  type        = string
  default     = null
  description = "ARN of lambda function that outputs session policies to be passed to the sts key lambda."
}

variable "subnet_ids" {
  type        = list(string)
  description = "VPC subnets used by Lambda functions"
  default     = null
}

variable "tags" {
  description = "Tags to be applied to managed resources"
  type        = map(string)
  default     = {}
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

variable "vpc_id" {
  type        = string
  description = "VPC used by Lambda functions"
  default     = null
}

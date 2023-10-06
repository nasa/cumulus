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

variable "deploy_to_ngap" {
  description = "Whether or not this instance of Cumulus is deployed to an NGAP environment"
  type        = bool
}

variable "deploy_s3_credentials_endpoint" {
  type         = bool
  default      = true
  description  = "Option to deploy the s3 credentials endpoint."
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas in the form <lambda_identifier>_memory_size: <memory_size>"
  type = map(string)
  default = {}
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas in the form <lambda_identifier>_timeout: <timeout>"
  type = map(string)
  default = {}
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "shared AWS:Log:Destination value. Requires log_api_gateway_to_cloudwatch set to true for TEA module."
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

variable "tea_api_gateway_stage" {
  type        = string
  default     = null
  description = "The API Gateway stage name for the Thin Egress App"
}

variable "tea_external_api_endpoint" {
  description = "Thin Egress App external endpoint URL"
  type        = string
  default     = null
}

variable "tea_rest_api_id" {
  description = "Thin Egress App API gateway ID"
  type        = string
  default     = null
}

variable "tea_rest_api_root_resource_id" {
  description = "Thin Egress App API gateway root resource ID"
  type        = string
  default     = null
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

variable "cmr_acl_based_credentials" {
  type = bool
  default = false
  description = "Option to enable/disable user based CMR ACLs to derive permission for s3 credential access tokens"
}

variable "vpc_id" {
  type        = string
  description = "VPC used by Lambda functions"
  default     = null
}

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {}
}

variable "default_log_retention_days" {
  type = number
  default = 30
  description = "default value that user chooses for their log retention periods"
}

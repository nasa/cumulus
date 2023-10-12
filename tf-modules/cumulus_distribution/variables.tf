variable "deploy_to_ngap" {
  description = "Whether or not this instance of Cumulus is deployed to an NGAP environment"
  type        = bool
}

variable "prefix" {
  type        = string
  description = "Resource prefix unique to this deployment"
}

variable "buckets" {
  description = "Map identifying the buckets for the deployment"
  type        = map(object({ name = string, type = string }))
  default     = {}
}

variable "bucketname_prefix" {
  type        = string
  description = "all data buckets should have names prefixed with this. Must be compatible with S3 naming conventions (lower case only, etc). An empty string can be used to indicate no prefix"
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

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
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

variable "bucket_map_file" {
  type        = string
  default     = "bucket_map.yaml"
  description = "path and file of bucketmap file's location in the system_bucket"
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

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
  description = "VPC subnets used by Lambda functions"
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type = map(number)
  default = {}
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type = map(number)
  default = {}
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

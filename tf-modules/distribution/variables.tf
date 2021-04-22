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

variable "lambda_subnet_ids" {
  type    = list(string)
  default = []
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

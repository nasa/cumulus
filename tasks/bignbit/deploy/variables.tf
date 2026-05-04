variable aws_profile {
  type        = string
  description = "The AWS profile name"
}

variable "lambda_security_group_ids" {
  type        = list(string)
  description = "The list of security group IDs to apply to tasks"
}

variable "lambda_subnet_ids" {
  type        = list(string)
  description = "The list of subnet IDs to deploy tasks into"
}

variable "prefix" {
  type        = string
  description = "The deployment prefix for this deployment of Cumulus"
}

variable "region" {
  type        = string
  default     = "us-west-2"
  description = "The AWS region where the resources should be deployed"
}

variable "stage" {
  type        = string
  description = "The environment where the resources should be deployed, e.g. sit, uat, prod"
}

variable "resource_identifier" {
  type        = string
  description = "The identifier added into resource names to differentiate consolidated resources from other DAAC resources"
}

variable "submit_to_gibs" {
  type        = bool
  description = "Whether BigNBit should submit to GIBS or deploy a mock SQS queue"
}

variable "system_bucket" {
  type        = string
  description = "The name of the bucket that holds Cumulus workflow configurations"
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

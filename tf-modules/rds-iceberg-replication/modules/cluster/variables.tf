variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type        = string
}

variable "region" {
  description = "Region to deploy module to"
  type        = string
  default     = "us-east-1"
}

variable "vpc_id" {
  description = "VPC ID for the Cumulus Deployment"
  type        = string
}

variable "iceberg_s3_bucket" {
  description = "S3 bucket where iceberg tables are stored"
  type = string
}

variable "tags" {
  description = "Tags to be applied to RDS cluster resources that support tags"
  type        = map(string)
  default     = {}
}
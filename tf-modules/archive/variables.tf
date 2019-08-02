# Required

variable "cmr_client_id" {
  type = string
}

variable "cmr_environment" {
  type = string
}

variable "cmr_password" {
  type = string
}

variable "cmr_provider" {
  type = string
}

variable "cmr_username" {
  type = string
}

variable "dynamo_tables" {
  type = map(string)
}

variable "ecs_cluster_name" {
  type = string
}

variable "elasticsearch_arn" {
  type = string
}

variable "elasticsearch_hostname" {
  type = string
}

variable "lambda_subnet_ids" {
  type = list(string)
}

variable "permissions_boundary_arn" {
  type = string
}

variable "prefix" {
  type = string
}

variable "system_bucket" {
  type = string
}

variable "urs_client_id" {
  type        = string
  description = "The URS app ID"
}

variable "urs_client_password" {
  type        = string
  description = "The URS app password"
}

variable "vpc_id" {
  type = string
}

# Optional

variable "private_buckets" {
  type    = list(string)
  default = []
}

variable "protected_buckets" {
  type    = list(string)
  default = []
}

variable "public_buckets" {
  type    = list(string)
  default = []
}

variable "urs_url" {
  type        = string
  default     = "https://urs.earthdata.nasa.gov/"
  description = "The URL of the Earthdata Login site"
}

# TODO Add descriptions

# Required variables

variable "prefix" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "system_bucket" {
  type = string
}

variable "urs_client_id" {
  type = string
}

variable "urs_client_password" {
  type = string
}

variable "vpc_id" {
  type = string
}

# Optional variables

variable "permissions_boundary" {
  type    = string
  default = null
}

variable "protected_buckets" {
  type    = list(string)
  default = []
}

variable "public_buckets" {
  type    = list(string)
  default = []
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "thin_egress_app_deployment_stage" {
  type    = string
  default = "DEV"
}

variable "thin_egress_app_domain_name" {
  type    = string
  default = null
}

variable "urs_url" {
  type    = string
  default = "https://urs.earthdata.nasa.gov"
}

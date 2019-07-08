variable "prefix" {
  type = string
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "ngap_sgs" {
  default = []
}

variable "permissions_boundary" {
  type    = string
  default = "NGAPShNonProdRoleBoundary"
}

variable "vpc_id" {
  type = string
}

variable "sts_credentials_lambda_arn" {
  type = string
  default = null
}

variable "tea_bucket_map_file" {
  type    = string
  default = null
}

variable "tea_bucketname_prefix" {
  type    = string
  default = ""
}

variable "tea_config_bucket" {
  type = string
}

variable "tea_domain_name" {
  type    = string
  default = null
}

variable "tea_stack_name" {
  type = string
}

variable "tea_stage_name" {
  type    = string
  default = "DEV"
}

variable "tea_subnet_ids" {
  type = list(string)
}

variable "tea_urs_auth_creds_secret_name" {
  type = string
}

variable "urs_client_id" {
  type = string
}

variable "urs_client_password" {
  type = string
}

variable "urs_url" {
  default = "https://uat.urs.earthdata.nasa.gov"
}
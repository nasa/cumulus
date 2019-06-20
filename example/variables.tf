variable "region" {
  type    = string
  default = "us-east-1"
}

variable "permissions_boundary" {
  type    = string
  default = "NGAPShNonProdRoleBoundary"
}

variable "vpc_id" {
  type = string
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

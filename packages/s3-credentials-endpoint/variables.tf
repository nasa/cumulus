# Required

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

variable "subnet_ids" {
  default = []
}

variable "urs_client_id" {
  type = string
}

variable "urs_client_password" {
  type = string
}

variable "urs_url" {
  type = string
}

variable "rest_api" {
  type = object({
    id               = string,
    root_resource_id = string
  })
}

variable "sts_credentials_lambda_arn" {
  type = string
}

# Optional

variable "permissions_boundary" {
  type    = string
  default = null
}

variable "redirect_path" {
  type    = string
  default = "redirect"
}

variable "s3credentials_path" {
  type    = string
  default = "s3credentials"
}

variable "stage_name" {
  type    = string
  default = "DEV"
}

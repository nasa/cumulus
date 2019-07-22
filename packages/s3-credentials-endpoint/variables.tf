# Required

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = array(string)
}

variable "prefix" {
  type = string
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

# Optional

variable "public_buckets" {
  type = list(string)
  default = []
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "sts_credentials_lambda_name" {
  type    = string
  default = "gsfc-ngap-sh-s3-sts-get-keys"
}

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

variable "prefix" {
  type = string
}

variable "region" {
  type = string
  default = "us-west-2"
}

variable "lambda_processing_role_arn" {
  type = string
}

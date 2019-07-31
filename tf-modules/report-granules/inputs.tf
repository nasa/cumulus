variable "aws_region" {
  type    =  string
  default = "us-east-1"
}

variable "aws_profile" {
  type = string
}

variable "prefix" {
  type = string
}

variable "granules_table_arn" {
  type = string
}

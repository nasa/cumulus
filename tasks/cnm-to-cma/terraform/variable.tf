variable "prefix" {
  type = string
}

# The location of footprint dataset-config file. Ex. s3://my-internal/datset-config/
variable "lambda_role" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

variable "subnet_ids" {
  type = list(string)
}

variable "region" {
  type = string
}

variable "app_name" {
  default = "workflow-normalizer"
}

variable "default_tags" {
  type = map(string)
  default = {}
}

variable "log_level" {
  type = string
  default = "info"
}

variable "memory_size" {
  type = number
  default = 512
}

variable "timeout" {
  type = number
  default = 120
}

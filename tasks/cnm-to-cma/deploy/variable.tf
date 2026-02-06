variable "prefix" {
  type = string
}

# The ARN of the IAM role that the Lambda function will assume when it executes.
# This role must have the necessary permissions to perform its tasks.
variable "lambda_role" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

variable "subnet_ids" {
  type = list(string)
}

variable "app_name" {
  default = "cnm_to_cma"
}

variable "default_tags" {
  type = map(string)
  default = {}
}

variable "memory_size" {
  type = number
  default = 512
}

variable "timeout" {
  type = number
  default = 120
}

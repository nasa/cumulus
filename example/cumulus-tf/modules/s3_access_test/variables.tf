variable "prefix" {
  type = string
}

variable "lambda_processing_role_arn" {
  type = string
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

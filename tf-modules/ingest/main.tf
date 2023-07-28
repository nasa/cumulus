terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.64.0"
    }
  }
}

locals {
  all_non_internal_buckets = [for k, v in var.buckets : v.name if v.type != "internal"]
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100"
    }
  }
}

locals {
  all_non_internal_buckets = [for k, v in var.buckets : v.name if v.type != "internal"]
}

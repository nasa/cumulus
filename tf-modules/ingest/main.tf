terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
    all_non_internal_buckets = [for k, v in var.buckets : v.name if v.type != "internal"]
}

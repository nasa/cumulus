terraform {
  required_providers {
   aws = "~> 3.0,!= 3.14.0"
  }
}

locals {
    all_non_internal_buckets = [for k, v in var.buckets : v.name if v.type != "internal"]
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}

locals {
  lambda_security_group_ids = compact([
    aws_security_group.no_ingress_all_egress[0].id,
  ])
  all_bucket_names = [for k, v in var.buckets : v.name]
  all_non_internal_buckets = [for k, v in var.buckets : v.name if v.type != "internal"]
  public_buckets = [for k, v in var.buckets : v.name if v.type == "public"]
  protected_buckets = [for k, v in var.buckets : v.name if v.type == "protected"]
  allowed_buckets = compact(flatten([
    local.all_non_internal_buckets,
    var.system_bucket
  ]))
}

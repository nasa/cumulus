terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  all_non_internal_buckets = [for k, v in var.buckets : v.name if v.type != "internal"]
  ecs_cluster_arn = data.terraform_remote_state.cumulus.outputs.ecs_cluster_arn
}

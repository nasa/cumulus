terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.0,!= 3.14.0"
    }
  }
}

locals {
  lambda_security_group_ids = compact([
    aws_security_group.no_ingress_all_egress[0].id,
    var.elasticsearch_security_group_id
  ])
}

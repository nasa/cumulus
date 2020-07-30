terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

locals {
  lambda_security_group_ids = compact([
    aws_security_group.no_ingress_all_egress[0].id,
    var.elasticsearch_security_group_id
  ])
}

data "aws_lambda_invocation" "verify_provider_secrets_migration" {
  function_name = aws_lambda_function.verify_provider_secrets_migration.function_name

  input = "{}"
}

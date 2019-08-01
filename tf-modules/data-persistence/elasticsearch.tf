locals {
  deploy_to_vpc  = var.vpc_id == null ? false : true
  es_domain_name = "${var.prefix}-${var.elasticsearch_config.domain_name}"
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "es_access_policy" {
  statement {
    actions = [
      "es:*"
    ]

    principals {
      type        = "AWS"
      identifiers = var.es_trusted_role_arns
    }

    resources = [
      "arn:aws:es:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:domain/${local.es_domain_name}/*"
    ]
  }
}

resource "aws_elasticsearch_domain_policy" "es_domain_policy" {
  count           = var.include_elasticsearch ? 1 : 0
  domain_name     = local.es_domain_name
  access_policies = data.aws_iam_policy_document.es_access_policy.json
}

resource "aws_iam_service_linked_role" "default" {
  count            = var.include_elasticsearch && local.deploy_to_vpc ? 1 : 0
  aws_service_name = "es.amazonaws.com"
}

resource "aws_elasticsearch_domain" "default" {
  count                 = var.include_elasticsearch ? 1 : 0
  domain_name           = local.es_domain_name
  elasticsearch_version = var.elasticsearch_config.version

  cluster_config {
    instance_type = var.elasticsearch_config.instance_type
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp2"
    volume_size = var.elasticsearch_config.volume_size
  }

  advanced_options = {
    "rest.action.multi.allow_explicit_index" = "true"
  }

  vpc_options {
    subnet_ids         = local.deploy_to_vpc ? null : var.subnet_ids
    security_group_ids = local.deploy_to_vpc ? null : var.security_groups
  }

  snapshot_options {
    automated_snapshot_start_hour = 0
  }
}

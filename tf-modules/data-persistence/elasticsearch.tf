locals {
  inside_vpc         = length(var.subnet_ids) > 0 ? true : false
  deploy_inside_vpc  = var.include_elasticsearch && local.inside_vpc
  deploy_outside_vpc = var.include_elasticsearch && local.inside_vpc == false
  include_es_policy  = length(var.es_trusted_role_arns) > 0 ? true : false
  default_domain_name = "${var.prefix}-${var.elasticsearch_config.domain_name}${local.inside_vpc ? "-vpc" : ""}"
  es_domain_name     = var.custom_domain_name == null ? local.default_domain_name : var.custom_domain_name
}

resource "aws_elasticsearch_domain" "es" {
  count                 = local.deploy_outside_vpc ? 1 : 0
  domain_name           = local.es_domain_name
  elasticsearch_version = var.elasticsearch_config.version

  cluster_config {
    instance_count = var.elasticsearch_config.instance_count
    instance_type  = var.elasticsearch_config.instance_type
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp2"
    volume_size = var.elasticsearch_config.volume_size
  }

  advanced_options = {
    "rest.action.multi.allow_explicit_index" = "true"
  }

  snapshot_options {
    automated_snapshot_start_hour = 0
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = local.default_tags
}

data "aws_iam_policy_document" "es_access_policy" {
  count = local.deploy_outside_vpc && local.include_es_policy ? 1 : 0

  statement {
    actions = ["es:*"]

    principals {
      type        = "AWS"
      identifiers = distinct(compact(var.es_trusted_role_arns))
    }

    resources = ["${aws_elasticsearch_domain.es[0].arn}/*"]
  }
}

resource "aws_elasticsearch_domain_policy" "es_domain_policy" {
  count           = local.deploy_outside_vpc && local.include_es_policy ? 1 : 0
  domain_name     = aws_elasticsearch_domain.es[0].domain_name
  access_policies = data.aws_iam_policy_document.es_access_policy[0].json
}

# Elasticsearch domain in a VPC

data "aws_subnet" "first_es_domain_subnet" {
  count = local.deploy_inside_vpc ? 1 : 0
  id    = var.subnet_ids[0]
}

resource "aws_security_group" "es_vpc" {
  count  = local.deploy_inside_vpc ? 1 : 0
  vpc_id = data.aws_subnet.first_es_domain_subnet[0].vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    self      = true
  }

  tags = local.default_tags
}

resource "aws_elasticsearch_domain" "es_vpc" {
  count                 = local.deploy_inside_vpc ? 1 : 0
  domain_name           = local.es_domain_name
  elasticsearch_version = var.elasticsearch_config.version

  cluster_config {
    instance_count = var.elasticsearch_config.instance_count
    instance_type  = var.elasticsearch_config.instance_type
    zone_awareness_enabled = length(var.subnet_ids) > 1
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
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.es_vpc[0].id]
  }

  snapshot_options {
    automated_snapshot_start_hour = 0
  }

  tags = local.default_tags
}

resource "aws_elasticsearch_domain_policy" "es_vpc_domain_policy" {
  count = local.deploy_inside_vpc ? 1 : 0

  domain_name     = local.es_domain_name
  access_policies = <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": ["*"]
      },
      "Action": ["es:*"],
      "Resource": "${aws_elasticsearch_domain.es_vpc[0].arn}/*"
    }
  ]
}
JSON
}

resource "aws_cloudwatch_metric_alarm" "es_nodes_low" {
  alarm_name          = "${local.es_domain_name}-NodesLowAlarm"
  comparison_operator = "LessThanThreshold"
  namespace           = "AWS/ES"
  evaluation_periods  = "5"
  metric_name         = "Nodes"
  period              = "60"
  statistic           = "Average"
  threshold           = var.elasticsearch_config.instance_count
  alarm_description   = "There are less instances running than the desired"
  tags                = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "es_nodes_high" {
  alarm_name          = "${local.es_domain_name}-NodesHighAlarm"
  comparison_operator = "GreaterThanThreshold"
  namespace           = "AWS/ES"
  evaluation_periods  = "5"
  metric_name         = "Nodes"
  period              = "60"
  statistic           = "Average"
  threshold           = var.elasticsearch_config.instance_count
  alarm_description   = "There are less instances running than the desired"
}

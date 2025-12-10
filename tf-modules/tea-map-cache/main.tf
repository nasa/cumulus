terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100, < 6.0.0"
    }
  }
}

data "aws_region" "current" {}

resource "aws_vpc_endpoint" "config" {
  count             = ! var.deploy_to_ngap && (var.vpc_id != null && length(var.lambda_subnet_ids) != 0) ? 1 : 0
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.execute-api"
  vpc_endpoint_type = "Interface"

  security_group_ids = [aws_security_group.no_ingress_all_egress[0].id]
  subnet_ids         = var.lambda_subnet_ids
  tags               = var.tags
}

resource "aws_lambda_function" "tea_cache" {
  function_name    = "${var.prefix}-TeaCache"
  description      = "Bootstrap lambda to write tea cache file"
  filename         = "${path.module}/../../packages/tea-map-cache/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/tea-map-cache/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs24.x"
  memory_size      = lookup(var.lambda_memory_sizes, "TeaCache", 512)
  timeout          = lookup(var.lambda_timeouts, "TeaCache", 120)
  environment {
    variables = {
      TEA_API = var.tea_api_url
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }
  tags = var.tags
}

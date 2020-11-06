terraform {
  required_providers {
   aws = "~> 3.0,!= 3.14.0"
  }
}
resource "aws_lambda_function" "tea_cache" {
  function_name    = "${var.prefix}-TeaCache"
  description      = "Bootstrap lambda to write tea cache file"
  filename         = "${path.module}/../../packages/tea-map-cache/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/tea-map-cache/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs12.x"
  memory_size      = 256
  timeout          = 120
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

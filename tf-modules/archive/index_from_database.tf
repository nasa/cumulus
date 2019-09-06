resource "aws_lambda_function" "index_from_database" {
  function_name    = "${var.prefix}-IndexFromDatabase"
  filename         = "${path.module}/../../packages/api/dist/indexFromDatabase/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/indexFromDatabase/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 512
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      ES_HOST         = var.elasticsearch_hostname
      stackName       = var.prefix
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id, var.elasticsearch_security_group_id]
  }
}

resource "aws_lambda_function" "index_from_database" {
  function_name    = "${var.prefix}-IndexFromDatabase"
  filename         = "${path.module}/../../packages/api/dist/indexFromDatabase/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/indexFromDatabase/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.lambda_processing.arn
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
  tags = {
    Project = var.prefix
  }
  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = [aws_security_group.no_ingress_all_egress.id]
  }
}

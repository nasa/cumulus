resource "aws_sqs_queue" "log2elasticsearch_dead_letter_queue" {
  name                       = "${var.prefix}-log2elasticsearchDeadLetterQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

resource "aws_lambda_function" "log2elasticsearch" {
  function_name    = "${var.prefix}-log2elasticsearch"
  filename         = "${path.module}/../../packages/api/dist/indexer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/indexer/lambda.zip")
  handler          = "index.logHandler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 100
  memory_size      = 320
  dead_letter_config {
    target_arn = aws_sqs_queue.log2elasticsearch_dead_letter_queue.arn
  }
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

resource "aws_lambda_permission" "log2elasticsearch" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.log2elasticsearch.arn
  principal     = "logs.${data.aws_region.current.name}.amazonaws.com"
}

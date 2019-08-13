resource "aws_sqs_queue" "sns2elasticsearch_dead_letter_queue" {
  name                       = "${var.prefix}-sns2elasticsearchDeadLetterQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
}

resource "aws_lambda_function" "sns2elasticsearch" {
  function_name    = "${var.prefix}-sns2elasticsearch"
  filename         = "${path.module}/../../packages/api/dist/indexer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/indexer/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.lambda_processing.arn
  runtime          = "nodejs8.10"
  timeout          = 100
  memory_size      = 320
  dead_letter_config {
    target_arn = aws_sqs_queue.sns2elasticsearch_dead_letter_queue.arn
  }
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      GranulesTable   = var.dynamo_tables.Granules
      ExecutionsTable = var.dynamo_tables.Executions
      PdrsTable       = var.dynamo_tables.Pdrs
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

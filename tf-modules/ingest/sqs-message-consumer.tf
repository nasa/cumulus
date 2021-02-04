resource "aws_lambda_function" "sqs_message_consumer" {
  function_name    = "${var.prefix}-sqsMessageConsumer"
  filename         = "${path.module}/../../packages/api/dist/sqsMessageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sqsMessageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs12.x"
  timeout          = 100
  memory_size      = 256
  environment {
    variables = {
      CMR_ENVIRONMENT          = var.cmr_environment
      stackName                = var.prefix
      CollectionsTable         = var.dynamo_tables.collections.name
      ProvidersTable           = var.dynamo_tables.providers.name
      RulesTable               = var.dynamo_tables.rules.name
      system_bucket            = var.system_bucket
      defaultSchedulerQueueUrl = local.defaultSchedulerQueueUrl
    }
  }
  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }
}

resource "aws_s3_bucket" "archived_sqs_messages_bucket" {
  bucket = "${var.prefix}-archivedSqsMessagesBucket"
  acl    = "private"

  lifecycle_rule {
    id      = "log"
    enabled = true
    expiration {
      days = 30
    }
  }

  versioning {
   	enabled = false
	}

  tags = var.tags
}

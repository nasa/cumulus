locals {
  # Pulled out into a local to prevent cyclic dependencies if/when
  # we move to a more restrictive IAM policy.
  sqs2sf_timeout = 200
}

resource "aws_lambda_function" "fallback_consumer" {
  function_name    = "${var.prefix}-fallbackConsumer"
  filename         = "${path.module}/../../packages/api/dist/messageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/messageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 100
  memory_size      = 256
  dead_letter_config {
    target_arn = aws_sqs_queue.kinesis_failure.arn
  }
  environment {
    variables = {
      CMR_ENVIRONMENT  = var.cmr_environment
      CollectionsTable = var.dynamo_tables.collections.name
      ProvidersTable   = var.dynamo_tables.providers.name
      RulesTable       = var.dynamo_tables.rules.name
      stackName        = var.prefix
      system_bucket    = var.system_bucket
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

resource "aws_lambda_function" "kinesis_inbound_event_logger" {
  function_name    = "${var.prefix}-KinesisInboundEventLogger"
  filename         = "${path.module}/../../packages/api/dist/payloadLogger/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/payloadLogger/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 300
  memory_size      = 128
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
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

resource "aws_lambda_function" "kinesis_outbound_event_logger" {
  function_name    = "${var.prefix}-KinesisOutboundEventLogger"
  filename         = "${path.module}/../../packages/api/dist/payloadLogger/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/payloadLogger/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 300
  memory_size      = 512
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
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

resource "aws_lambda_function" "manual_consumer" {
  function_name    = "${var.prefix}-manualConsumer"
  filename         = "${path.module}/../../packages/api/dist/manualConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/manualConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 100
  memory_size      = 256
  environment {
    variables = {
      CMR_ENVIRONMENT  = var.cmr_environment
      stackName        = var.prefix
      CollectionsTable = var.dynamo_tables.collections.name
      ProvidersTable   = var.dynamo_tables.providers.name
      RulesTable       = var.dynamo_tables.rules.name
      system_bucket    = var.system_bucket
      FallbackTopicArn = aws_sns_topic.kinesis_fallback.arn
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

resource "aws_lambda_function" "message_consumer" {
  function_name    = "${var.prefix}-messageConsumer"
  filename         = "${path.module}/../../packages/api/dist/messageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/messageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 100
  memory_size      = 256
  environment {
    variables = {
      CMR_ENVIRONMENT  = var.cmr_environment
      stackName        = var.prefix
      CollectionsTable = var.dynamo_tables.collections.name
      ProvidersTable   = var.dynamo_tables.providers.name
      RulesTable       = var.dynamo_tables.rules.name
      system_bucket    = var.system_bucket
      FallbackTopicArn = aws_sns_topic.kinesis_fallback.arn
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

resource "aws_lambda_function" "schedule_sf" {
  function_name    = "${var.prefix}-ScheduleSF"
  description      = "This lambda function is invoked by scheduled rules created via cumulus API"
  filename         = "${path.module}/../../packages/api/dist/sfScheduler/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfScheduler/lambda.zip")
  handler          = "index.schedule"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 100
  memory_size      = 192
  dead_letter_config {
    target_arn = aws_sqs_queue.schedule_sf_dead_letter_queue.arn
  }
  environment {
    variables = {
      CMR_ENVIRONMENT  = var.cmr_environment
      CollectionsTable = var.dynamo_tables.collections.name
      ProvidersTable   = var.dynamo_tables.providers.name
      stackName        = var.prefix
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

resource "aws_lambda_function" "sf_semaphore_down" {
  function_name    = "${var.prefix}-sfSemaphoreDown"
  filename         = "${path.module}/../../packages/api/dist/sfSemaphoreDown/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfSemaphoreDown/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 100
  memory_size      = 512
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
      SemaphoresTable = var.dynamo_tables.semaphores.name
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

resource "aws_lambda_function" "sf_sqs_report_task" {
  function_name    = "${var.prefix}-SfSqsReport"
  filename         = "${path.module}/../../tasks/sf-sqs-report/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/sf-sqs-report/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 300
  memory_size      = 1024

  layers = [var.cumulus_message_adapter_lambda_layer_arn]

  environment {
    variables = {
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
      CMR_ENVIRONMENT             = var.cmr_environment
      stackName                   = var.prefix
      ExecutionsTable             = var.dynamo_tables.executions.name
      reporting_queue_url         = var.sf_event_sqs_to_db_records_sqs_queue_url
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

resource "aws_lambda_function" "sqs2sf" {
  function_name    = "${var.prefix}-sqs2sf"
  filename         = "${path.module}/../../packages/api/dist/sfStarter/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfStarter/lambda.zip")
  handler          = "index.sqs2sfEventSourceHandler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = local.sqs2sf_timeout
  memory_size      = 128
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
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

resource "aws_lambda_function" "sqs2sfThrottle" {
  function_name    = "${var.prefix}-sqs2sfThrottle"
  filename         = "${path.module}/../../packages/api/dist/sfStarter/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfStarter/lambda.zip")
  handler          = "index.sqs2sfThrottleHandler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 200
  memory_size      = 128
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
      SemaphoresTable = var.dynamo_tables.semaphores.name
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

resource "aws_lambda_function" "sqs_message_consumer" {
  function_name    = "${var.prefix}-sqsMessageConsumer"
  filename         = "${path.module}/../../packages/api/dist/sqsMessageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sqsMessageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 100
  memory_size      = 256
  environment {
    variables = {
      CMR_ENVIRONMENT  = var.cmr_environment
      stackName        = var.prefix
      CollectionsTable = var.dynamo_tables.collections.name
      ProvidersTable   = var.dynamo_tables.providers.name
      RulesTable       = var.dynamo_tables.rules.name
      system_bucket    = var.system_bucket
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

resource "aws_lambda_function" "sqs_message_remover" {
  function_name    = "${var.prefix}-sqsMessageRemover"
  filename         = "${path.module}/../../packages/api/dist/sqsMessageRemover/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sqsMessageRemover/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 100
  memory_size      = 256
  environment {
    variables = {
      CMR_ENVIRONMENT  = var.cmr_environment
      stackName        = var.prefix
      system_bucket    = var.system_bucket
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

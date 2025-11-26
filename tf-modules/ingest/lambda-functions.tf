locals {
  # Pulled out into a local to prevent cyclic dependencies if/when
  # we move to a more restrictive IAM policy.
  sqs2sf_timeout = 200
  defaultSchedulerQueueUrl = aws_sqs_queue.start_sf.id
}

resource "aws_lambda_function" "fallback_consumer" {
  function_name    = "${var.prefix}-fallbackConsumer"
  filename         = "${path.module}/../../packages/api/dist/messageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/messageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "fallbackConsumer", 100)
  memory_size      = lookup(var.lambda_memory_sizes, "fallbackConsumer", 512)
  dead_letter_config {
    target_arn = aws_sqs_queue.kinesis_failure.arn
  }
  environment {
    variables = {
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
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "KinesisInboundEventLogger", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "KinesisInboundEventLogger", 512)
  environment {
    variables = {
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
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "KinesisOutboundEventLogger", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "KinesisOutboundEventLogger", 512)
  environment {
    variables = {
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
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "manualConsumer", 100)
  memory_size      = lookup(var.lambda_memory_sizes, "manualConsumer", 512)
  environment {
    variables = {
      stackName                = var.prefix
      system_bucket            = var.system_bucket
      FallbackTopicArn         = aws_sns_topic.kinesis_fallback.arn
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

resource "aws_lambda_function" "message_consumer" {
  function_name    = "${var.prefix}-messageConsumer"
  filename         = "${path.module}/../../packages/api/dist/messageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/messageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "messageConsumer", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "messageConsumer", 512)
  environment {
    variables = {
      stackName                = var.prefix
      system_bucket            = var.system_bucket
      FallbackTopicArn         = aws_sns_topic.kinesis_fallback.arn
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

resource "aws_lambda_function" "schedule_sf" {
  function_name    = "${var.prefix}-ScheduleSF"
  description      = "This lambda function is invoked by scheduled rules created via cumulus API"
  filename         = "${path.module}/../../packages/api/dist/sfScheduler/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfScheduler/lambda.zip")
  handler          = "index.handleScheduleEvent"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "ScheduleSF", 100)
  memory_size      = lookup(var.lambda_memory_sizes, "ScheduleSF", 512)
  dead_letter_config {
    target_arn = aws_sqs_queue.schedule_sf_dead_letter_queue.arn
  }
  environment {
    variables = {
      stackName                = var.prefix
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

resource "aws_lambda_function" "sf_semaphore_down" {
  function_name    = "${var.prefix}-sfSemaphoreDown"
  filename         = "${path.module}/../../packages/api/dist/sfSemaphoreDown/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfSemaphoreDown/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "sfSemaphoreDown", 100)
  memory_size      = lookup(var.lambda_memory_sizes, "sfSemaphoreDown", 512)
  environment {
    variables = {
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
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "SfSqsReport", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "SfSqsReport", 512)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
      stackName                   = var.prefix
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
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "sqs2sf", local.sqs2sf_timeout)
  memory_size      = lookup(var.lambda_memory_sizes, "sqs2sf", 512)
  environment {
    variables = {
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
  runtime          = "nodejs20.x"
  # To avoid overlapping invocations of this lambda, set this to a default of 60 seconds
  timeout          = lookup(var.lambda_timeouts, "sqs2sfThrottle", 60)
  memory_size      = lookup(var.lambda_memory_sizes, "sqs2sfThrottle", 512)
  environment {
    variables = {
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
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "sqsMessageConsumer", 100)
  memory_size      = lookup(var.lambda_memory_sizes, "sqsMessageConsumer", 512)
  environment {
    variables = {
      stackName                = var.prefix
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

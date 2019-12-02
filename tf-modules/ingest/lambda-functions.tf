resource "aws_lambda_function" "fallback_consumer" {
  function_name    = "${var.prefix}-fallbackConsumer"
  filename         = "${path.module}/../../packages/api/dist/messageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/messageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
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
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "kinesis_inbound_event_logger" {
  function_name    = "${var.prefix}-KinesisInboundEventLogger"
  filename         = "${path.module}/../../packages/api/dist/payloadLogger/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/payloadLogger/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 128
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "kinesis_outbound_event_logger" {
  function_name    = "${var.prefix}-KinesisOutboundEventLogger"
  filename         = "${path.module}/../../packages/api/dist/payloadLogger/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/payloadLogger/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 512
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "message_consumer" {
  function_name    = "${var.prefix}-messageConsumer"
  filename         = "${path.module}/../../packages/api/dist/messageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/messageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
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
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "schedule_sf" {
  function_name    = "${var.prefix}-ScheduleSF"
  description      = "This lambda function is invoked by scheduled rules created via cumulus API"
  filename         = "${path.module}/../../packages/api/dist/sfScheduler/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfScheduler/lambda.zip")
  handler          = "index.schedule"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
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
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "sf_semaphore_down" {
  function_name    = "${var.prefix}-sfSemaphoreDown"
  filename         = "${path.module}/../../packages/api/dist/sfSemaphoreDown/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfSemaphoreDown/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 100
  memory_size      = 512
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
      SemaphoresTable = var.dynamo_tables.semaphores.name
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "sf_sns_report_task" {
  function_name    = "${var.prefix}-SfSnsReport"
  filename         = "${path.module}/../../tasks/sf-sns-report/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/sf-sns-report/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 1024

  layers = [var.cumulus_message_adapter_lambda_layer_arn]

  environment {
    variables = {
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
      CMR_ENVIRONMENT             = var.cmr_environment
      stackName                   = var.prefix
      ExecutionsTable             = var.dynamo_tables.executions.name
      execution_sns_topic_arn     = var.report_executions_sns_topic_arn
      granule_sns_topic_arn       = var.report_granules_sns_topic_arn
      pdr_sns_topic_arn           = var.report_pdrs_sns_topic_arn
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "sqs2sf" {
  function_name    = "${var.prefix}-sqs2sf"
  filename         = "${path.module}/../../packages/api/dist/sfStarter/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfStarter/lambda.zip")
  handler          = "index.sqs2sfHandler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 200
  memory_size      = 128
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "sqs2sfThrottle" {
  function_name    = "${var.prefix}-sqs2sfThrottle"
  filename         = "${path.module}/../../packages/api/dist/sfStarter/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sfStarter/lambda.zip")
  handler          = "index.sqs2sfThrottleHandler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 200
  memory_size      = 128
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
      SemaphoresTable = var.dynamo_tables.semaphores.name
    }
  }

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }

  tags = merge(local.default_tags, { Project = var.prefix })
}

resource "aws_lambda_function" "sqs_message_consumer" {
  function_name    = "${var.prefix}-sqsMessageConsumer"
  filename         = "${path.module}/../../packages/api/dist/sqsMessageConsumer/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sqsMessageConsumer/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
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
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_lambda_function" "sqs_message_remover" {
  function_name    = "${var.prefix}-sqsMessageRemover"
  filename         = "${path.module}/../../packages/api/dist/sqsMessageRemover/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/sqsMessageRemover/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 100
  memory_size      = 256
  environment {
    variables = {
      CMR_ENVIRONMENT  = var.cmr_environment
      stackName        = var.prefix
      system_bucket    = var.system_bucket
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}


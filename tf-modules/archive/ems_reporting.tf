# EMS Distribution Report

resource "aws_lambda_function" "ems_distribution_report" {
  count            = var.ems_deploy ? 1 : 0
  function_name    = "${var.prefix}-EmsDistributionReport"
  filename         = "${path.module}/../../packages/api/dist/emsDistributionReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/emsDistributionReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs12.x"
  timeout          = 900
  memory_size      = 320
  environment {
    variables = {
      CMR_ENVIRONMENT                  = var.cmr_environment
      CMR_HOST                         = var.cmr_custom_host
      CollectionsTable                 = var.dynamo_tables.collections.name
      FilesTable                       = var.dynamo_tables.files.name
      GranulesTable                    = var.dynamo_tables.granules.name
      ems_dataSource                   = var.ems_datasource
      ems_host                         = var.ems_host
      ems_path                         = var.ems_path
      ems_port                         = var.ems_port
      ems_privateKey                   = var.ems_private_key
      ems_provider                     = var.ems_provider
      ems_retentionInDays              = var.ems_retention_in_days
      ems_submitReport                 = var.ems_submit_report
      ems_username                     = var.ems_username
      stackName                        = var.prefix
      system_bucket                    = var.system_bucket
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

resource "aws_cloudwatch_event_rule" "daily_ems_distribution_report" {
  count = var.ems_deploy ? 1 : 0
  name = "${var.prefix}_daily_ems_distribution_report"
  schedule_expression = "cron(0 8 * * ? *)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "daily_ems_distribution_report" {
  count = var.ems_deploy ? 1 : 0
  target_id = "ems_distribution_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_ems_distribution_report[0].name
  arn  = aws_lambda_function.ems_distribution_report[0].arn
}

resource "aws_lambda_permission" "daily_ems_distribution_report" {
  count         = var.ems_deploy ? 1 : 0
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ems_distribution_report[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_ems_distribution_report[0].arn
}

# EMS Product Metadata Report

resource "aws_lambda_function" "ems_product_metadata_report" {
  count            = var.ems_deploy ? 1 : 0
  function_name    = "${var.prefix}-EmsProductMetadataReport"
  filename         = "${path.module}/../../packages/api/dist/emsProductMetadataReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/emsProductMetadataReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 320
  environment {
    variables = {
      CMR_ENVIRONMENT                  = var.cmr_environment
      CMR_HOST                         = var.cmr_custom_host
      CollectionsTable                 = var.dynamo_tables.collections.name
      ems_dataSource                   = var.ems_datasource
      ems_host                         = var.ems_host
      ems_path                         = var.ems_path
      ems_port                         = var.ems_port
      ems_privateKey                   = var.ems_private_key
      ems_provider                     = var.ems_provider
      ems_retentionInDays              = var.ems_retention_in_days
      ems_submitReport                 = var.ems_submit_report
      ems_username                     = var.ems_username
      stackName                        = var.prefix
      system_bucket                    = var.system_bucket
      launchpad_api                    = var.launchpad_api
      launchpad_certificate            = var.launchpad_certificate
      launchpad_passphrase_secret_name = length(var.launchpad_passphrase) == 0 ? null : aws_secretsmanager_secret.api_launchpad_passphrase.name
      cmr_client_id                    = var.cmr_client_id
      cmr_oauth_provider               = var.cmr_oauth_provider
      cmr_password_secret_name         = length(var.cmr_password) == 0 ? null : aws_secretsmanager_secret.api_cmr_password.name
      cmr_provider                     = var.cmr_provider
      cmr_username                     = var.cmr_username
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

resource "aws_cloudwatch_event_rule" "daily_ems_product_metadata_report" {
  count = var.ems_deploy ? 1 : 0
  name  = "${var.prefix}_daily_ems_product_metadata_report"
  schedule_expression = "cron(0 4 * * ? *)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "daily_ems_product_metadata_report" {
  count     = var.ems_deploy ? 1 : 0
  target_id = "ems_product_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_ems_product_metadata_report[0].name
  arn  = aws_lambda_function.ems_product_metadata_report[0].arn
}

resource "aws_lambda_permission" "daily_ems_product_metadata_report" {
  count         = var.ems_deploy ? 1 : 0
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ems_product_metadata_report[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_ems_product_metadata_report[0].arn
}

# EMS Ingest Report

resource "aws_sqs_queue" "ems_ingest_report_dead_letter_queue" {
  count                      = var.ems_deploy ? 1 : 0
  name                       = "${var.prefix}-EmsIngestReportDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = var.tags
}

resource "aws_lambda_function" "ems_ingest_report" {
  count            = var.ems_deploy ? 1 : 0
  function_name    = "${var.prefix}-EmsIngestReport"
  filename         = "${path.module}/../../packages/api/dist/emsIngestReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/emsIngestReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs12.x"
  timeout          = 300
  memory_size      = 320
  dead_letter_config {
    target_arn = aws_sqs_queue.ems_ingest_report_dead_letter_queue[0].arn
  }
  environment {
    variables = {
      CMR_ENVIRONMENT     = var.cmr_environment
      CMR_HOST            = var.cmr_custom_host
      CollectionsTable    = var.dynamo_tables.collections.name
      ES_HOST             = var.elasticsearch_hostname
      ems_dataSource      = var.ems_datasource
      ems_host            = var.ems_host
      ems_path            = var.ems_path
      ems_port            = var.ems_port
      ems_privateKey      = var.ems_private_key
      ems_provider        = var.ems_provider
      ems_retentionInDays = var.ems_retention_in_days
      ems_submitReport    = var.ems_submit_report
      ems_username        = var.ems_username
      stackName           = var.prefix
      system_bucket       = var.system_bucket
    }
  }
  tags = var.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = local.lambda_security_group_ids
    }
  }
}

resource "aws_cloudwatch_event_rule" "daily_ems_ingest_report" {
  count = var.ems_deploy ? 1 : 0
  name = "${var.prefix}_daily_ems_ingest_report"
  schedule_expression = "cron(0 5 * * ? *)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "daily_ems_ingest_report" {
  count     = var.ems_deploy ? 1 : 0
  target_id = "ems_ingest_lambda_target"
  rule = aws_cloudwatch_event_rule.daily_ems_ingest_report[0].name
  arn  = aws_lambda_function.ems_ingest_report[0].arn
}

resource "aws_lambda_permission" "daily_ems_ingest_report" {
  count         = var.ems_deploy ? 1 : 0
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ems_ingest_report[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_ems_ingest_report[0].arn
}

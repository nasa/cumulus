# EMS Distribution Report

resource "aws_lambda_function" "ems_distribution_report" {
  function_name    = "${var.prefix}-EmsDistributionReport"
  filename         = "${path.module}/../../packages/api/dist/emsDistributionReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/emsDistributionReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 900
  memory_size      = 320
  environment {
    variables = {
      CMR_ENVIRONMENT     = var.cmr_environment
      CollectionsTable    = var.dynamo_tables.collections.name
      FilesTable          = var.dynamo_tables.files.name
      GranulesTable       = var.dynamo_tables.granules.name
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
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_cloudwatch_event_rule" "daily_ems_distribution_report" {
  schedule_expression = "cron(0 8 * * ? *)"
  tags                = local.default_tags
}

resource "aws_cloudwatch_event_target" "daily_ems_distribution_report" {
  rule = aws_cloudwatch_event_rule.daily_ems_distribution_report.name
  arn  = aws_lambda_function.ems_distribution_report.arn
}

resource "aws_lambda_permission" "daily_ems_distribution_report" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ems_distribution_report.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_ems_distribution_report.arn
}

# EMS Product Metadata Report

resource "aws_lambda_function" "ems_product_metadata_report" {
  function_name    = "${var.prefix}-EmsProductMetadataReport"
  filename         = "${path.module}/../../packages/api/dist/emsProductMetadataReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/emsProductMetadataReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 320
  environment {
    variables = {
      CMR_ENVIRONMENT     = var.cmr_environment
      CollectionsTable    = var.dynamo_tables.collections.name
      cmr_client_id       = var.cmr_client_id
      cmr_provider        = var.cmr_provider
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
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }
}

resource "aws_cloudwatch_event_rule" "daily_ems_product_metadata_report" {
  schedule_expression = "cron(0 4 * * ? *)"
  tags                = local.default_tags
}

resource "aws_cloudwatch_event_target" "daily_ems_product_metadata_report" {
  rule = aws_cloudwatch_event_rule.daily_ems_product_metadata_report.name
  arn  = aws_lambda_function.ems_product_metadata_report.arn
}

resource "aws_lambda_permission" "daily_ems_product_metadata_report" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ems_product_metadata_report.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_ems_product_metadata_report.arn
}

# EMS Ingest Report

resource "aws_sqs_queue" "ems_ingest_report_dead_letter_queue" {
  name                       = "${var.prefix}-EmsIngestReportDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = local.default_tags
}

resource "aws_lambda_function" "ems_ingest_report" {
  function_name    = "${var.prefix}-EmsIngestReport"
  filename         = "${path.module}/../../packages/api/dist/emsIngestReport/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/emsIngestReport/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 320
  dead_letter_config {
    target_arn = aws_sqs_queue.ems_ingest_report_dead_letter_queue.arn
  }
  environment {
    variables = {
      CMR_ENVIRONMENT     = var.cmr_environment
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
  tags = merge(local.default_tags, { Project = var.prefix })

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id, var.elasticsearch_security_group_id]
  }
}

resource "aws_cloudwatch_event_rule" "daily_ems_ingest_report" {
  schedule_expression = "cron(0 5 * * ? *)"
  tags                = local.default_tags
}

resource "aws_cloudwatch_event_target" "daily_ems_ingest_report" {
  rule = aws_cloudwatch_event_rule.daily_ems_ingest_report.name
  arn  = aws_lambda_function.ems_ingest_report.arn
}

resource "aws_lambda_permission" "daily_ems_ingest_report" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ems_ingest_report.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_ems_ingest_report.arn
}

# data "archive_file" "base_dependency_layer_zip" {
#   type        = "zip"
#   output_path = "${var.DIST_DIR}/opera/base_dependency_layer.zip"
#
#   source_dir = "${var.DIST_DIR}/opera/base_dependency_layer/"
# }
#
# data "archive_file" "opera_dependency_layer_zip" {
#   type        = "zip"
#   output_path = "${var.DIST_DIR}/opera/opera_dependency_layer.zip"
#
#   source_dir = "${var.DIST_DIR}/opera/opera_dependency_layer/"
# }
#
# data "archive_file" "opera_lambdas_zip" {
#   type        = "zip"
#   output_path = "${var.DIST_DIR}/opera/opera_lambdas.zip"
#
#   source_dir = "${var.DIST_DIR}/opera/opera_lambdas/"
# }

resource "aws_lambda_layer_version" "lambda_base_dependencies" {
  // Layer is created using requirements.txt
  filename            = "${var.DIST_DIR}/opera/base_dependency_layer.zip"
  layer_name          = "${local.module_prefix}-base_lambda_dependencies"
  source_code_hash    = filebase64sha256("${var.DIST_DIR}/opera/base_dependency_layer.zip")
  compatible_runtimes = [local.python_version]
}

resource "aws_lambda_layer_version" "lambda_dependencies" {
  filename            = "${var.DIST_DIR}/opera/opera_dependency_layer.zip"
  layer_name          = "${local.module_prefix}_lambda_dependencies"
  source_code_hash    = filebase64sha256("${var.DIST_DIR}/opera/opera_dependency_layer.zip")
  compatible_runtimes = [local.python_version]
}

resource "aws_lambda_function" "cnm_sqs_logger" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-cnm_sqs_logger"
  role          = local.lambda_processing_role_arn
  handler       = "cnm_sqs_logger.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout = 10

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {
      LOG_LEVEL    = local.log_level
      WORKFLOW_SQS = aws_sqs_queue.workflow_queue.url

    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_lambda_function" "dedupe_send_to_queue" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-dedupe_send_to_queue"
  role          = aws_iam_role.dedupe_execution_role.arn
  handler       = "dedupe_send_to_queue.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 60 * 5
  memory_size = 256

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {
      START_SF_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/596205514787/dms-opex-sbx-startSF"
      TABLE_NAME         = aws_dynamodb_table.dedupe_granules.name
    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_cloudwatch_log_group" "dedupe_send_to_queue_logs" {
  name              = "/aws/lambda/${aws_lambda_function.dedupe_send_to_queue.function_name}"
  retention_in_days = 7
}

resource "aws_lambda_function" "dedupe_write_to_db" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-dedupe_write_to_db"
  role          = aws_iam_role.dedupe_execution_role.arn
  handler       = "dedupe_write_to_db.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 60
  memory_size = 256

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {
      TABLE_NAME   = aws_dynamodb_table.dedupe_granules.name
    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_cloudwatch_log_group" "dedupe_write_to_db_logs" {
  name              = "/aws/lambda/${aws_lambda_function.dedupe_write_to_db.function_name}"
  retention_in_days = 7
}

resource "aws_lambda_function" "get_md" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-get_md"
  role          = local.lambda_processing_role_arn
  handler       = "get_md.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 300
  memory_size = 2048

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_lambda_function" "get_cmr_md" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-get_cmr_md"
  role          = local.lambda_processing_role_arn
  handler       = "get_cmr_md.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 300
  memory_size = 256

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_lambda_function" "get_cnm" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-get_cnm"
  role          = local.lambda_processing_role_arn
  handler       = "get_cnm.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 300
  memory_size = 256

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {

    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_lambda_function" "generate_browse" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-generate_browse"
  role          = local.lambda_processing_role_arn
  handler       = "generate_browse.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 300
  memory_size = 512

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {

    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_lambda_function" "generate_ummg" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-generate_ummg"
  role          = local.lambda_processing_role_arn
  handler       = "generate_ummg.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 300
  memory_size = 512

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {
      S3_PRODUCT_BUCKET = "${local.module_prefix}-products"
      DISTRIBUTION_URL  = local.distribution_url
      DOWNLOAD_HOST     = var.download_host
    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_lambda_function" "make_disp_stack_granule" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-make_disp_stack_granule"
  role          = local.lambda_processing_role_arn
  handler       = "make_disp_stack_granule.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 300
  memory_size = 512

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {

    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

resource "aws_lambda_function" "response" {
  filename      = "${var.DIST_DIR}/opera/opera_lambdas.zip"
  function_name = "${local.module_prefix}-response"
  role          = local.lambda_processing_role_arn
  handler       = "response.lambda_handler"
  layers = [
    aws_lambda_layer_version.lambda_base_dependencies.arn,
    aws_lambda_layer_version.lambda_dependencies.arn,
  ]
  timeout     = 60
  memory_size = 256

  source_code_hash = filebase64sha256("${var.DIST_DIR}/opera/opera_lambdas.zip")
  runtime          = local.python_version
  environment {
    variables = {
      RESPONSE_SQS_MAP = jsonencode(
        merge(
          {
            "TEST" : aws_sqs_queue.mock_response_queue.url
          }
        )
      )

    }
  }
  logging_config {
    application_log_level = local.log_level
    log_format            = "JSON"
    system_log_level      = local.log_level
  }
}

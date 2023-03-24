resource "aws_lambda_function" "async_operation_fail" {
  depends_on       = [aws_cloudwatch_log_group.async_operation_fail]
  function_name    = "${var.prefix}-AsyncOperationFail"
  filename         = "${path.module}/../lambdas/asyncOperations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/asyncOperations/lambda.zip")
  handler          = "index.fail"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "async_operation_fail" {
  name              = "/aws/lambda/${var.prefix}-AsyncOperationFail"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "AsyncOperationFail", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_function" "async_operation_success" {
  depends_on       = [aws_cloudwatch_log_group.async_operation_success]
  function_name    = "${var.prefix}-AsyncOperationSuccess"
  filename         = "${path.module}/../lambdas/asyncOperations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/asyncOperations/lambda.zip")
  handler          = "index.success"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "async_operation_success" {
  name              = "/aws/lambda/${var.prefix}-AsyncOPerationSuccess"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "AsyncOperationSuccess", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_function" "sns_s3_executions_test" {
  depends_on       = [aws_cloudwatch_log_group.sns_s3_executions_test]
  function_name    = "${var.prefix}-SnsS3ExecutionsTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handleExecutions"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  environment {
    variables = {
      system_bucket = var.system_bucket
      stackName     = var.prefix
    }
  }

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "sns_s3_executions_test" {
  name              = "/aws/lambda/${var.prefix}-SnsS3ExecutionsTest"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "SnsS3ExecutionsTest", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_function" "sns_s3_granules_test" {
  depends_on       = [aws_cloudwatch_log_group.sns_s3_granules_test]
  function_name    = "${var.prefix}-SnsS3GranulesTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handleGranules"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  environment {
    variables = {
      system_bucket = var.system_bucket
      stackName     = var.prefix
    }
  }

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "sns_s3_granules_test" {
  name              = "/aws/lambda/${var.prefix}-SnsS3GranulesTest"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "SnsS3GranulesTest", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_function" "sns_s3_pdrs_test" {
  depends_on       = [aws_cloudwatch_log_group.sns_s3_pdrs_test]
  function_name    = "${var.prefix}-SnsS3PdrsTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handlePdrs"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  environment {
    variables = {
      system_bucket = var.system_bucket
      stackName     = var.prefix
    }
  }

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "sns_s3_pdrs_test" {
  name              = "/aws/lambda/${var.prefix}-SnsS3PdrsTest"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "SnsS3PdrsTest", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_function" "sns_s3_collections_test" {
  depends_on       = [aws_cloudwatch_log_group.sns_s3_collections_test]
  function_name    = "${var.prefix}-SnsS3CollectionsTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handleCollections"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  environment {
    variables = {
      system_bucket = var.system_bucket
      stackName     = var.prefix
    }
  }

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "sns_s3_collections_test" {
  name              = "/aws/lambda/${var.prefix}-SnsS3CollectionsTest"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "SnsS3CollectionsTest", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_lambda_function" "ftpPopulateTestLambda" {
  depends_on       = [aws_cloudwatch_log_group.ftpPopulateTestLambda]
  function_name    = "${var.prefix}-populateTestLambda"
  filename         = "${path.module}/../lambdas/ftpPopulateTestLambda/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/ftpPopulateTestLambda/dist/lambda.zip")
  handler          = "index.handler"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"

  environment {
    variables = {
      FAKE_PROVIDER_CONFIG_BUCKET = var.ftp_host_configuration_bucket
      stackName     = var.prefix
    }
  }

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "ftpPopulateTestLambda" {
  name              = "/aws/lambda/${var.prefix}-populateTestLambda"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "populateTestLambda", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_secretsmanager_secret" "lzards_api_client_test_launchpad_passphrase" {
  name_prefix = "${var.prefix}-lzards-api-client-test-launchpad-passphrase"
  description = "Launchpad passphrase for the Cumulus API's ${var.prefix} deployment"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "lzards_api_client_test_launchpad_passphrase" {
  count         = length(var.launchpad_passphrase) == 0 ? 0 : 1
  secret_id     = aws_secretsmanager_secret.lzards_api_client_test_launchpad_passphrase.id
  secret_string = var.launchpad_passphrase
}

resource "aws_lambda_function" "lzards_api_client_test" {
  depends_on       = [aws_cloudwatch_log_group.lzards_api_client_test]
  function_name    = "${var.prefix}-LzardsApiClientTest"
  filename         = "${path.module}/../lambdas/lzardsClientTest/dist/webpack/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/lzardsClientTest/dist/webpack/lambda.zip")
  handler          = "index.handler"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = 600
  memory_size      = 512

  environment {
    variables = {
      system_bucket                           = var.system_bucket
      stackName                               = var.prefix
      lzards_api                              = var.lzards_api
      launchpad_api                           = var.launchpad_api
      lzards_launchpad_certificate            = var.launchpad_certificate
      lzards_launchpad_passphrase_secret_name = length(var.launchpad_passphrase) == 0 ? null : aws_secretsmanager_secret.lzards_api_client_test_launchpad_passphrase.name
    }
  }

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_cloudwatch_log_group" "lzards_api_client_test" {
  name              = "/aws/lambda/${var.prefix}-LzardsApiClientTest"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "LzardsApiClientTest", var.default_log_retention_days)
  tags              = var.tags
}

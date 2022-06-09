resource "aws_lambda_function" "async_operation_fail" {
  function_name    = "${var.prefix}-AsyncOperationFail"
  filename         = "${path.module}/../lambdas/asyncOperations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/asyncOperations/lambda.zip")
  handler          = "index.fail"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs14.x"

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_lambda_function" "async_operation_success" {
  function_name    = "${var.prefix}-AsyncOperationSuccess"
  filename         = "${path.module}/../lambdas/asyncOperations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/asyncOperations/lambda.zip")
  handler          = "index.success"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs14.x"

  tags = local.tags

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }
}

resource "aws_lambda_function" "sns_s3_executions_test" {
  function_name    = "${var.prefix}-SnsS3ExecutionsTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handleExecutions"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs14.x"

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

resource "aws_lambda_function" "sns_s3_granules_test" {
  function_name    = "${var.prefix}-SnsS3GranulesTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handleGranules"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs14.x"

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

resource "aws_lambda_function" "sns_s3_pdrs_test" {
  function_name    = "${var.prefix}-SnsS3PdrsTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handlePdrs"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs14.x"

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

resource "aws_lambda_function" "sns_s3_collections_test" {
  function_name    = "${var.prefix}-SnsS3CollectionsTest"
  filename         = "${path.module}/../lambdas/snsS3Test/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/snsS3Test/lambda.zip")
  handler          = "index.handleCollections"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs14.x"

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

resource "aws_lambda_function" "ftpPopulateTestLambda" {
  function_name    = "${var.prefix}-populateTestLambda"
  filename         = "${path.module}/../lambdas/ftpPopulateTestLambda/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/ftpPopulateTestLambda/dist/lambda.zip")
  handler          = "index.handler"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs14.x"

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

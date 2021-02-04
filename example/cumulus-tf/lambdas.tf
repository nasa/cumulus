resource "aws_lambda_function" "async_operation_fail" {
  function_name    = "${var.prefix}-AsyncOperationFail"
  filename         = "${path.module}/../lambdas/asyncOperations/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/asyncOperations/lambda.zip")
  handler          = "index.fail"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs12.x"

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
  runtime          = "nodejs12.x"

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
  runtime          = "nodejs12.x"

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
  runtime          = "nodejs12.x"

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
  runtime          = "nodejs12.x"

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
  runtime          = "nodejs12.x"

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

data "aws_s3_bucket" "data_backups" {
  bucket = "cumulus-dynamo-data-backups"
}

data "aws_iam_policy_document" "lambda_processing_access_data_backups" {
  statement {
    actions = [
      "s3:GetBucket*",
      "s3:ListBucket*",
    ]
    resources = [
      data.aws_s3_bucket.data_backups.arn
    ]
  }
}

resource "aws_iam_role_policy" "lambda_processing_access_data_backups" {
  name   = "${var.prefix}-access-data-backups"
  role   = split("/", module.cumulus.lambda_processing_role_arn)[1]
  policy = data.aws_iam_policy_document.lambda_processing_access_data_backups.json
}

resource "aws_lambda_function" "copy_data_backups" {
  function_name    = "${var.prefix}-copy-data-backups"
  filename         = "${path.module}/../lambdas/copy-data-backups/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/copy-data-backups/lambda.zip")
  handler          = "index.handler"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs12.x"

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

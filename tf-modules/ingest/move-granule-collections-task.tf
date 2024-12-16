resource "aws_lambda_function" "move_granule_collections_task" {
  function_name    = "${var.prefix}-MoveGranuleCollections"
  filename         = "${path.module}/../../tasks/move-granule-collections/dist/webpack/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/move-granule-collections/dist/webpack/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.move_granule_collections_task_role.arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "MoveGranuleCollections", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "MoveGranuleCollections", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CUMULUS_MESSAGE_ADAPTER_DIR       = "/opt/"
      default_s3_multipart_chunksize_mb = var.default_s3_multipart_chunksize_mb
      stackName                         = var.prefix
      system_bucket                     = var.system_bucket
      databaseCredentialSecretArn  = var.rds_user_access_secret_arn
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id,
        var.rds_security_group
      ]
    }
  }

  tags = var.tags
}

resource "aws_security_group" "move_granule_collections_task" {
  count = length(var.lambda_subnet_ids) == 0 ? 0 : 1

  name   = "${var.prefix}-move_granule_collections_task"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

data "aws_iam_policy_document" "move_granule_collections_task_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "move_granule_collections_task_role" {
  name                 = "${var.prefix}-move_granule_collections_task"
  assume_role_policy   = data.aws_iam_policy_document.move_granule_collections_task_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "move_granule_collections_task_policy" {
  statement {
    actions = [
      "ecs:RunTask",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "lambda:GetFunctionConfiguration",
      "lambda:invokeFunction",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "s3:GetBucket*",
    ]
    resources = [ "arn:aws:s3:::${var.system_bucket}/*"]
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetObject*",
      "s3:PutObject*",
      "s3:ListMultipartUploadParts",
    ]
    resources = [ "arn:aws:s3:::${var.system_bucket}/*"]
  }

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.rds_user_access_secret_arn
    ]
  }
}

resource "aws_iam_role_policy" "move_granule_collections_task" {
  name   = "${var.prefix}_move_granule_collections_task"
  role   = aws_iam_role.move_granule_collections_task_role.id
  policy = data.aws_iam_policy_document.move_granule_collections_task_policy.json
}

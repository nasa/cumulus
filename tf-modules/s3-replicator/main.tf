terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source = "hashicorp/archive"
    }
  }
}

locals {
  security_group_ids_set = var.security_group_ids != null
}

data "archive_file" "replicator_package" {
  type        = "zip"
  source_file = "${path.module}/index.js"
  output_path = "${path.module}/build/replicator.zip"
}

resource "aws_security_group" "s3_replicator_lambda" {
  count  = local.security_group_ids_set ? 0 : 1
  vpc_id = var.vpc_id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "aws_lambda_function" "s3_replicator" {
  filename      = data.archive_file.replicator_package.output_path
  function_name = "${var.prefix}-s3-replicator"
  role          = aws_iam_role.replicator_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = lookup(var.lambda_timeouts, "s3-replicator", 300)
  memory_size   = lookup(var.lambda_memory_sizes, "s3-replicator", 512)

  source_code_hash = data.archive_file.replicator_package.output_base64sha256

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = local.security_group_ids_set ? var.security_group_ids : [aws_security_group.s3_replicator_lambda[0].id]
  }

  environment {
    variables = {
      TARGET_BUCKET = var.target_bucket
      TARGET_PREFIX = var.target_prefix
    }
  }

  tags = var.tags
}

resource "aws_lambda_permission" "s3_replicator_permission" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.s3_replicator.arn
  principal     = "s3.amazonaws.com"
}

resource "aws_s3_bucket_notification" "s3_replicator_trigger" {
  bucket = var.source_bucket

  lambda_function {
    lambda_function_arn = aws_lambda_function.s3_replicator.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = var.source_prefix
  }
}

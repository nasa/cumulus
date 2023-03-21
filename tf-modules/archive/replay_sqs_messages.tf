data "aws_iam_policy_document" "replay_sqs_messages_policy" {

  statement {
    actions   = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject"
    ]
    resources = ["arn:aws:s3:::${var.system_bucket}/*"]
  }

  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

    statement {
      actions = [
        "sqs:SendMessage",
        "sqs:GetQueueUrl",
      ]
      resources = ["arn:aws:sqs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role" "replay_sqs_messages_role" {
  name                 = "${var.prefix}_replay_sqs_messages_role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role_policy" "replay_sqs_messages_role_policy" {
  name   = "${var.prefix}_replay_sqs_messages_lambda_role_policy"
  role   = aws_iam_role.replay_sqs_messages_role.id
  policy = data.aws_iam_policy_document.replay_sqs_messages_policy.json
}

resource "aws_lambda_function" "replay_sqs_messages" {
  filename         = "${path.module}/../../packages/api/dist/replaySqsMessages/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/replaySqsMessages/lambda.zip")
  function_name    = "${var.prefix}-replaySqsMessages"
  role             = aws_iam_role.replay_sqs_messages_role.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      system_bucket                = var.system_bucket
      stackName                    = var.prefix
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.no_ingress_all_egress[0].id,
        var.rds_security_group
      ])
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "replay_sqs_messages" {
  name = "/aws/lambda/${aws_lambda_function.replay_sqs_messages.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "replaySqsMessages", var.default_log_retention_days)
  tags = var.tags
}

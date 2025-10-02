# IAM role for Lambda execution
data "aws_iam_policy_document" "assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}
data "aws_iam_policy_document" "ec2_cleanup_policy" {
  statement {
    actions = [
      "ec2:TerminateInstances",
      "ec2:DescribeInstances"
    ]
    resources = ["*"]
  }
}
resource "aws_iam_role" "ec2_cleanup" {
  name               = "ec2_cleanup_role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

resource "aws_iam_role_policy" "ec2_cleanup" {
  name   = "lambda_ec2_access"
  role   = aws_iam_role.ec2_cleanup.id
  policy = data.aws_iam_policy_document.ec2_cleanup_policy.json
}

# Package the Lambda function code
data "archive_file" "ec2_cleanup" {
  type        = "zip"
  source_file = "${path.module}/index.py"
  output_path = "${path.module}/lambda/index.zip"
}

# Lambda function
resource "aws_lambda_function" "ec2_cleanup" {
  filename         = data.archive_file.ec2_cleanup.output_path
  function_name    = "ec2_cleanup"
  role             = aws_iam_role.ec2_cleanup.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.ec2_cleanup.output_base64sha256

  runtime = "python3.12"
  timeout = 150
  environment {
    variables = {
      ENVIRONMENT = "sandbox"
      LOG_LEVEL   = "INFO"
    }
  }

  tags = {
    Environment = "production"
    Application = "sandbox"
  }
}

resource "aws_cloudwatch_event_rule" "daily_ec2_cleanup" {
  name                = "daily_ec2_cleanup"
  schedule_expression = "cron(* * * * ? *)"
}

resource "aws_cloudwatch_event_target" "daily_ec2_cleanup" {
  target_id = "ec2_cleanup_lambda_target"
  rule      = aws_cloudwatch_event_rule.daily_ec2_cleanup.name
  arn       = aws_lambda_function.ec2_cleanup.arn
}

resource "aws_lambda_permission" "daily_ec2_cleanup" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ec2_cleanup.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_ec2_cleanup.arn
}

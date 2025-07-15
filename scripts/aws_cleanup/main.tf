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
  type = "zip"
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

  runtime = "python3.10"
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
resource "aws_iam_role" "ec2_cleanup_scheduler" {
  name               = "ec2_cleanup_scheduler_role"
  assume_role_policy = data.aws_iam_policy_document.assume_scheduler_role.json
}


data "aws_iam_policy_document" "assume_scheduler_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

# resource "aws_cloudwatch_event_rule" "scheduler" {
#   name                = "every_minute_test_schulder"
#   description         = "Rule to trigger every minute"
#   event_bus_name      = data.aws_cloudwatch_event_bus.default.name
#   schedule_expression = "cron(* * * * ? *)" // Triggers every minute, could also be rate(1 minute)
# }
resource "aws_scheduler_schedule" "schedule_ec2_cleanup" {
  name       = "schedule_ec2_cleanup"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "rate(1 minutes)"

  target {
    arn      = aws_lambda_function.ec2_cleanup.arn
    role_arn = aws_iam_role.ec2_cleanup_scheduler.arn
  }
}

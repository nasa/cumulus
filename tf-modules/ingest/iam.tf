data "aws_iam_policy_document" "application_autoscaling_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["application-autoscaling.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "states_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

# URS password
# Secrets setup for URS auth in ingest tasks

resource "aws_secretsmanager_secret" "ingest_urs_password" {
  name_prefix = "${var.prefix}-ingest_urs_password"
  description = "URS user pasword for use by ingest lambdas in the ${var.prefix} deployment"
  tags        = local.default_tags
}

resource "aws_secretsmanager_secret_version" "ingest_urs_password" {
  count         = length(var.urs_password) == 0 ? 0 : 1
  secret_id     = aws_secretsmanager_secret.ingest_urs_password.id
  secret_string = var.urs_password
}

data "aws_iam_policy_document" "lambda_processing_role_ingest_urs_password" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.ingest_urs_password.arn

    ]
  }
}

resource "aws_iam_role_policy" "lambda_processing_role_ingest_urs_password" {
  role   = split("/", var.lambda_processing_role_arn)[1]
  policy = data.aws_iam_policy_document.lambda_processing_role_ingest_urs_password.json
}



# Scaling role

resource "aws_iam_role" "scaling" {
  name                 = "${var.prefix}-scaling-role"
  assume_role_policy   = data.aws_iam_policy_document.application_autoscaling_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "scaling_policy" {
  statement {
    actions = [
      "application-autoscaling:*",
      "cloudwatch:DeleteAlarms",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:GetMetricStatistics",
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:SetAlarmState",
      "dynamodb:DescribeTable",
      "dynamodb:UpdateTable",
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "scaling" {
  role   = aws_iam_role.scaling.id
  policy = data.aws_iam_policy_document.scaling_policy.json
}

# Step role

resource "aws_iam_role" "step" {
  name                 = "${var.prefix}-steprole"
  assume_role_policy   = data.aws_iam_policy_document.states_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  # TODO Re-enable once IAM permissions have been fixed
  # tags                 = local.default_tags
}

data "aws_iam_policy_document" "step_policy" {
  statement {
    actions = [
      "lambda:InvokeFunction",
      "ecr:*",
      "cloudtrail:LookupEvents",
      "ecs:RunTask",
      "ecs:StopTask",
      "ecs:DescribeTasks",
      "autoscaling:Describe*",
      "cloudwatch:*",
      "logs:*",
      "sns:*",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:GetRole",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "step" {
  role   = aws_iam_role.step.id
  policy = data.aws_iam_policy_document.step_policy.json
}

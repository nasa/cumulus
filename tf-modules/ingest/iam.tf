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

  statement {
    actions = [
      "events:DescribeRule",
      "events:PutRule",
      "events:PutTargets"
    ]
    # TODO Where is this being created?
    resources = ["arn:aws:events:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:rule/StepFunctionsGetEventsForECSTaskRule"]
  }
}

resource "aws_iam_role_policy" "step" {
  role   = aws_iam_role.step.id
  policy = data.aws_iam_policy_document.step_policy.json
}

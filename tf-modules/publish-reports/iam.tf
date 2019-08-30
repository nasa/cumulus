data "aws_caller_identity" "current" { }

data "aws_iam_policy_document" "assume_lambda_role" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions   = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "publish_reports_lambda_role" {
  name                 = "${var.prefix}_publish_reports_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role.json
  permissions_boundary = var.permissions_boundary
}

data "aws_iam_policy_document" "publish_reports_policy_document" {
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = [
      "*"
    ]
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
      "SNS:Publish"
    ]
    resources = [
      var.execution_sns_topic_arn,
      var.granule_sns_topic_arn,
      var.pdr_sns_topic_arn
    ]
  }
}

resource "aws_iam_role_policy" "publish_reports_lambda_role_policy" {
  name   = "${var.prefix}_publish_reports_lambda_role_policy"
  role   = aws_iam_role.publish_reports_lambda_role.id
  policy = data.aws_iam_policy_document.publish_reports_policy_document.json
}

data "aws_iam_policy_document" "assume_lambda_role" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "replicator_lambda_role" {
  name                 = "${var.prefix}_replicator_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role.json
  permissions_boundary = var.permissions_boundary
  tags                 = var.tags
}

data "aws_iam_policy_document" "replicator_policy_document" {
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
      "s3:GetObject*",
      "s3:PutObject*"
    ]
    resources = [
      "arn:aws:s3:::${var.source_bucket}/${var.source_prefix}/*",
      "arn:aws:s3:::${var.target_bucket}/${var.target_prefix}/*"
    ]
  }
}

resource "aws_iam_role_policy" "replicator_lambda_role_policy" {
  name   = "${var.prefix}_replicator_lambda_role_policy"
  role   = aws_iam_role.replicator_lambda_role.id
  policy = data.aws_iam_policy_document.replicator_policy_document.json
}

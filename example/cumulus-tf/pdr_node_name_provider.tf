resource "aws_s3_bucket" "pdr_node_name_provider" {
  bucket = "${var.prefix}-pdr-node-name-provider"

  tags = local.tags
}

data "aws_iam_policy_document" "lambda_processing_pdr_node_name_provider_policy" {
  statement {
    actions = [
      "s3:ListBucket"
    ]
    resources = [aws_s3_bucket.pdr_node_name_provider.arn]
  }

  statement {
    actions = [
      "s3:GetObject*"
    ]
    resources = ["${aws_s3_bucket.pdr_node_name_provider.arn}/*"]
  }
}

resource "aws_iam_role_policy" "lambda_processing_pdr_node_name_provider" {
  name   = "${var.prefix}_pdr_node_name_provider"
  role   = reverse(split("/", module.cumulus.lambda_processing_role_arn))[0]
  policy = data.aws_iam_policy_document.lambda_processing_pdr_node_name_provider_policy.json
}

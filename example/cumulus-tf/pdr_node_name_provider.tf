data "aws_iam_policy_document" "lambda_processing_pdr_node_name_provider_policy" {
  statement {
    actions = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.pdr_node_name_provider_bucket}"]
  }

  statement {
    actions = ["s3:GetObject*"]
    resources = ["arn:aws:s3:::${var.pdr_node_name_provider_bucket}/*"]
  }
}

resource "aws_iam_role_policy" "lambda_processing_pdr_node_name_provider" {
  name   = "${var.prefix}_pdr_node_name_provider"
  role   = reverse(split("/", module.cumulus.lambda_processing_role_arn))[0]
  policy = data.aws_iam_policy_document.lambda_processing_pdr_node_name_provider_policy.json
}

resource "aws_kms_key" "lambda_processing_authentication_key" {
  description = "${var.prefix} Lambda Processing credentials encryption"
  tags        = var.tags
}

data "aws_iam_policy_document" "lambda_processing_authentication" {
  statement {
    actions   = [
      "kms:Encrypt",
      "kms:Decrypt"
    ]
    resources = [aws_kms_key.lambda_processing_authentication_key.arn]
  }
}

resource "aws_iam_role_policy" "lambda_processing_authentication" {
  role   = var.lambda_processing_role_id
  policy = data.aws_iam_policy_document.lambda_processing_authentication.json
}

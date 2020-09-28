resource "aws_kms_key" "provider_kms_key" {
  description = "${var.prefix} Provider credentials encryption"
  tags        = var.tags
}

data "aws_iam_policy_document" "provider_secrets_encryption" {
  statement {
    actions   = [
      "kms:Encrypt",
      "kms:Decrypt"
    ]
    resources = [aws_kms_key.provider_kms_key.arn]
  }
}

resource "aws_iam_role_policy" "provider_secrets_encryption" {
  name   = "${var.prefix}_provider_secrets_encryption_policy"
  role   = aws_iam_role.lambda_api_gateway.id
  policy = data.aws_iam_policy_document.provider_secrets_encryption.json
}

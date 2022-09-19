data "aws_cloudformation_export" "fake_s3_provider" {
  name = "cumulus-fake-s3-provider-bucket"
}
data "aws_cloudformation_export" "fake_s3_provider_alternate" {
  name = "cumulus-fake-s3-provider-bucket-alternate"
}

data "aws_s3_bucket" "fake_s3_provider" {
  bucket = data.aws_cloudformation_export.fake_s3_provider.value
}

data "aws_s3_bucket" "fake_s3_provider_alternate" {
  bucket = data.aws_cloudformation_export.fake_s3_provider_alternate.value
}

data "aws_s3_bucket" "fake_s3_ftp_host_configuration_bucket" {
  bucket = var.ftp_host_configuration_bucket
}

data "aws_iam_policy_document" "lambda_processing_access_fake_s3_provider" {
  statement {
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetBucket*",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket*",
      "s3:PutAccelerateConfiguration",
      "s3:PutBucket*",
      "s3:PutLifecycleConfiguration",
      "s3:PutReplicationConfiguration"
    ]
    resources = [
      data.aws_s3_bucket.fake_s3_provider.arn,
      data.aws_s3_bucket.fake_s3_provider_alternate.arn

    ]
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:GetObject*",
      "s3:ListMultipartUploadParts",
      "s3:PutObject*"
    ]
    resources = [
      "${data.aws_s3_bucket.fake_s3_provider.arn}/*",
      "${data.aws_s3_bucket.fake_s3_provider_alternate.arn}/*",
      "${data.aws_s3_bucket.fake_s3_ftp_host_configuration_bucket.arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "lambda_processing_access_fake_s3_provider" {
  name   = "${var.prefix}-fake-s3-provider"
  role   = split("/", module.cumulus.lambda_processing_role_arn)[1]
  policy = data.aws_iam_policy_document.lambda_processing_access_fake_s3_provider.json
}

data "aws_iam_policy_document" "lzards_api_client_test_processing_role_get_secrets" {
  count         = length(var.launchpad_passphrase) == 0 ? 0 : 1
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.lzards_api_client_test_launchpad_passphrase.arn,
    ]
  }
}

resource "aws_iam_role_policy" "lzards_api_client_test_processing_role_get_secrets" {
  count  = length(var.launchpad_passphrase) == 0 ? 0 : 1
  name   = "${var.prefix}_lzards_api_client_test_processing_role_get_secrets_policy"
  role   = split("/", module.cumulus.lambda_processing_role_arn)[1]
  policy = data.aws_iam_policy_document.lzards_api_client_test_processing_role_get_secrets[0].json
}

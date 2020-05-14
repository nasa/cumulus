data "aws_cloudformation_export" "fake_s3_provider" {
  name = "cumulus-fake-s3-provider-bucket"
}

data "aws_s3_bucket" "fake_s3_provider" {
  bucket = data.aws_cloudformation_export.fake_s3_provider.value
}

data "aws_iam_policy_document" "lambda_processing_access_fake_s3_provider" {
  statement {
    actions = [
      "s3:GetObject"
    ]
    resources = [
      data.aws_s3_bucket.fake_s3_provider.arn
    ]
  }
}

resource "aws_iam_role_policy" "lambda_processing_access_fake_s3_provider" {
  name   = "${var.prefix}-fake-s3-provider"
  role   = split("/", module.cumulus.lambda_processing_role_arn)[1]
  policy = data.aws_iam_policy_document.lambda_processing_access_fake_s3_provider.json
}

# KMS key used to encrypt BigNBit SSM parameters
resource "aws_kms_key" "bignbit_parameter_key" {
  description         = "Key used to encrypt BigNBit SSM parameters"
  enable_key_rotation = true
}

data "aws_iam_policy_document" "bignbit_parameter_key_policy" {
  # Allow deployment users to manage the key
  statement {
    effect    = "Allow"
    actions   = [
      "kms:Create*",
      "kms:Describe*",
      "kms:Enable*",
      "kms:List*",
      "kms:Put*",
      "kms:Update*",
      "kms:Revoke*",
      "kms:Disable*",
      "kms:Get*",
      "kms:Delete*",
      "kms:ScheduleKeyDeletion",
      "kms:CancelKeyDeletion"
    ]
    resources = [
      aws_kms_key.bignbit_parameter_key.arn
    ]

    principals {
      type        = "AWS"
      identifiers = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/NGAPAdmin",
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/NGAPShApplicationDeveloper"
      ]
    }
  }

  # Allow BigNBit roles to use the key (but not manage it)
  statement {
    effect    = "Allow"
    actions   = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey"
    ]
    resources = [
      aws_kms_key.bignbit_parameter_key.arn
    ]

    principals {
      type        = "AWS"
      identifiers = [
        module.bignbit.bignbit_lambda_role.arn
      ]
    }
  }
}

resource "aws_kms_key_policy" "bignbit_parameter_key_policy" {
  key_id = aws_kms_key.bignbit_parameter_key.key_id
  policy = data.aws_iam_policy_document.bignbit_parameter_key_policy.json
}

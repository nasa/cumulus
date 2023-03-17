resource "aws_lambda_function" "lzards_backup_task" {
  count            = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  function_name    = "${var.prefix}-LzardsBackup"
  filename         = "${path.module}/../../tasks/lzards-backup/dist/webpack/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/lzards-backup/dist/webpack/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs16.x"
  timeout          = lookup(var.lambda_timeouts, "lzards_backup_task_timeout", 900)
  memory_size      = lookup(var.lambda_memory_sizes, "lzards_backup_task_memory_size", 512)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      stackName                               = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR             = "/opt/"
      system_bucket                           = var.system_bucket
      lzards_launchpad_passphrase_secret_name = length(var.lzards_launchpad_passphrase) == 0 ? null : aws_secretsmanager_secret.lzards_launchpad_passphrase[0].name
      lzards_launchpad_certificate            = var.lzards_launchpad_certificate
      launchpad_api	                          = var.launchpad_api
      backup_role_arn                         = aws_iam_role.lambda_backup_role[0].arn
      lzards_api                              = var.lzards_api
      lzards_provider                         = var.lzards_provider
      lzards_s3_link_timeout                  = var.lzards_s3_link_timeout
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }

  tags = var.tags
}

# Lambda backup role

data "aws_iam_policy_document" "lambda_backup_role_policy" {
  count         = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type = "AWS"
      identifiers = [var.lambda_processing_role_arn]
    }
  }
}

resource "aws_iam_role_policy" "lambda_backup" {
  count  = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  name   = "${var.prefix}_lambda_backup_policy"
  role   = aws_iam_role.lambda_backup_role[0].id
  policy = data.aws_iam_policy_document.lambda_backup_policy[0].json
}


resource "aws_iam_role" "lambda_backup_role" {
  count                = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  name                 = "${var.prefix}-lambda-backups"
  assume_role_policy   = data.aws_iam_policy_document.lambda_backup_role_policy[0].json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

data "aws_iam_policy_document" "lambda_backup_policy" {
  count         = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  statement {
    actions = [
      "s3:GetBucket*",
      "s3:ListBucket*",
    ]
    resources = [for b in local.all_non_internal_buckets : "arn:aws:s3:::${b}"]
  }
  statement {
    actions = [
      "s3:GetObject*"
    ]
    resources = [for b in local.all_non_internal_buckets : "arn:aws:s3:::${b}/*"]
  }
  statement {
    actions = ["s3:GetObject*"]
    resources = ["arn:aws:s3:::${var.system_bucket}/*"]
  }
}

resource "aws_secretsmanager_secret" "lzards_launchpad_passphrase" {
  count       = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  name_prefix = "${var.prefix}-lzards-launchpad-passphrase"
  description = "Launchpad passphrase for the lzards-backup task from the ${var.prefix} deployment"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "lzards_launchpad_passphrase" {
  count         = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  secret_id     = aws_secretsmanager_secret.lzards_launchpad_passphrase[0].id
  secret_string = var.launchpad_passphrase
}

data "aws_iam_policy_document" "lzards_processing_role_get_secrets" {
  count         = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.lzards_launchpad_passphrase[0].arn,
    ]
  }
}

resource "aws_iam_role_policy" "lzards_processing_role_get_secrets" {
  count  = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  name   = "${var.prefix}_lzards_processing_role_get_secrets_policy"
  role   = split("/", var.lambda_processing_role_arn)[1]
  policy = data.aws_iam_policy_document.lzards_processing_role_get_secrets[0].json
}

resource "aws_cloudwatch_log_group" "lzards_backup_task" {
  count             = length(var.lzards_launchpad_passphrase) == 0 ? 0 : 1
  name              = "/aws/lambda/${aws_lambda_function.lzards_backup_task[0].function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "lzardsBackupTask_log_retention", var.default_log_retention_days)
  tags              = var.tags
}

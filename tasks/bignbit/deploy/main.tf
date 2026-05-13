provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Deployment = var.prefix
    }
  }
}


resource "aws_sqs_queue" "mock_gibs_queue" {
  count = var.submit_to_gibs ? 0 : 1

  name                      = "${var.prefix}-bignbit-${lower(var.resource_identifier)}-mock-gibs-queue"
  message_retention_seconds = 21600 # 6 hours
  sqs_managed_sse_enabled   = true
}

# TODO: CUMULUS-4785 should address these locals (make ENVs/create new fifo queue/etc. as needed)
locals {
  # The GIBS account and queue information can be found here: https://wiki.earthdata.nasa.gov/x/i4GEHQ
  bignbit_gibs_region     = var.submit_to_gibs ? "us-east-1" : "us-west-2"
  bignbit_gibs_account_id = "095845367016"
  bignbit_gibs_queue_name = var.submit_to_gibs ? "gitc-uat-ASDC-IN.fifo" : aws_sqs_queue.mock_gibs_queue[0].name
}

resource "aws_s3_object" "bignbit_collection_config" {
  for_each = fileset("${path.module}/bignbit_collections", "*.cfg")

  bucket = var.system_bucket
  key    = "dataset-config-${lower(var.resource_identifier)}/${each.value}"
  source = "${path.module}/bignbit_collections/${each.value}"
}

resource "aws_ssm_parameter" "bignbit_edl_username" {
  name        = "${var.prefix}-bignbit-${lower(var.resource_identifier)}-edl-username"
  type        = "SecureString"
  value       = "CHANGEME"
  description = "EDL username used by BigNBit when querying CMR"
  key_id      = aws_kms_key.bignbit_parameter_key.id

  lifecycle {
    ignore_changes = [ value ]
  }
}

resource "aws_ssm_parameter" "bignbit_edl_password" {
  name        = "${var.prefix}-bignbit-${lower(var.resource_identifier)}-edl-password"
  type        = "SecureString"
  value       = "CHANGEME"
  description = "EDL password used by BigNBit when querying CMR"
  key_id      = aws_kms_key.bignbit_parameter_key.id

  lifecycle {
    ignore_changes = [ value ]
  }
}

module "bignbit" {
  #checkov:skip=CKV_TF_1: This module uses a release artifact, so no commit hash is required
  #checkov:skip=CKV_TF_2: This module uses a release artifact, so no tag is required
  source                     = "https://github.com/podaac/bignbit/releases/download/0.4.1/bignbit-0.4.1-cumulus-tf.zip"
  app_name                   = "bignbit-${lower(var.resource_identifier)}"
  prefix                     = var.prefix
  stage                      = var.stage
  subnet_ids                 = var.lambda_subnet_ids
  security_group_ids         = var.lambda_security_group_ids
  lambda_container_image_uri = "ghcr.io/podaac/bignbit/bignbit:0.4.1"
  permissions_boundary_arn   = null

  data_buckets = [
    "cumulus-${var.stage}-public",
    "cumulus-${var.stage}-protected",
  ]

  bignbit_audit_bucket = var.system_bucket
  bignbit_audit_path   = "bignbit-audit-${lower(var.resource_identifier)}"

  config_bucket = var.system_bucket
  config_dir    = "dataset-config-${lower(var.resource_identifier)}"

  edl_user_ssm = aws_ssm_parameter.bignbit_edl_username.name
  edl_pass_ssm = aws_ssm_parameter.bignbit_edl_password.name

  harmony_job_status_interval_seconds  = 20
  harmony_job_status_max_attempts      = 15
  harmony_job_status_backoff_rate      = 1.0
  harmony_job_status_max_delay_seconds = 20

  gibs_region     = local.bignbit_gibs_region
  gibs_account_id = local.bignbit_gibs_account_id
  gibs_queue_name = local.bignbit_gibs_queue_name

  default_tags = var.tags

  depends_on = [
    aws_ssm_parameter.bignbit_edl_username,
    aws_ssm_parameter.bignbit_edl_password
  ]
}

data "aws_iam_policy_document" "bignbit_lambda_role_additional_policy" {
  # Allows BigNBit tasks to access encrypted secrets and SSM parameters
  statement {
    effect    = "Allow"
    actions   = [
      "kms:Decrypt",
      "kms:GenerateDataKey"
    ]
    resources = [
      "arn:aws:kms:${var.region}:665503794793:key/5c7cb79a-fc0a-41f6-97cb-2dd5df504f7e" # cumulus-uat-secrets
    ]
  }
}

resource "aws_iam_policy" "bignbit_lambda_role_additional_policy" {
  name   = "${module.bignbit.bignbit_lambda_role.name}-additional"
  policy = data.aws_iam_policy_document.bignbit_lambda_role_additional_policy.json
  tags   = var.tags
}

resource "aws_iam_role_policy_attachment" "bignbit_lambda_role_additional_policy_attachment" {
  role       = module.bignbit.bignbit_lambda_role.name
  policy_arn = aws_iam_policy.bignbit_lambda_role_additional_policy.arn
}

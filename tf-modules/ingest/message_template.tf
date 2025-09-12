# CMR password

resource "aws_secretsmanager_secret" "message_template_cmr_password" {
  name_prefix = "${var.prefix}-message-template-cmr-password"
  description = "CMR password for the Cumulus message template in the ${var.prefix} deployment"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "message_template_cmr_password" {
  count         = length(var.cmr_password) == 0 ? 0 : 1
  secret_id     = aws_secretsmanager_secret.message_template_cmr_password.id
  secret_string = var.cmr_password
}

# Launchpad passphrase

resource "aws_secretsmanager_secret" "message_template_launchpad_passphrase" {
  name_prefix = "${var.prefix}-message-template-launchpad-passphrase"
  description = "Launchpad passphrase for the Cumulus message template in the ${var.prefix} deployment"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "message_template_launchpad_passphrase" {
  count         = length(var.launchpad_passphrase) == 0 ? 0 : 1
  secret_id     = aws_secretsmanager_secret.message_template_launchpad_passphrase.id
  secret_string = var.launchpad_passphrase
}

data "aws_iam_policy_document" "lambda_processing_role_get_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.message_template_cmr_password.arn,
      aws_secretsmanager_secret.message_template_launchpad_passphrase.arn
    ]
  }
}

resource "aws_iam_role_policy" "lambda_processing_role_get_secrets" {
  name   = "${var.prefix}_lambda_processing_role_get_secrets_policy"
  role   = split("/", var.lambda_processing_role_arn)[1]
  policy = data.aws_iam_policy_document.lambda_processing_role_get_secrets.json
}

locals {
  default_queue_execution_limits = {
    (aws_sqs_queue.background_processing.id) = 5
  }
  custom_queue_execution_limits = { for queue in var.throttled_queues: queue.url => queue.execution_limit }

  message_template_key = "${var.prefix}/workflow_template.json"

  message_template = jsonencode({
    cumulus_meta = merge({
      message_source          = "sfn"
      system_bucket           = var.system_bucket
      state_machine           = null
      execution_name          = null
      workflow_start_time     = null
      queueExecutionLimits    = merge(local.default_queue_execution_limits, local.custom_queue_execution_limits)
      sf_event_sqs_to_db_records_types = lookup(var.workflow_configurations, "sf_event_sqs_to_db_records_types", {})
    }, jsondecode(file("${path.module}/cumulus_version.json")))
    meta = {
      workflow_name  = null
      workflow_tasks = {}
      stack          = var.prefix
      buckets        = var.buckets
      cmr = {
        oauthProvider      = var.cmr_oauth_provider
        username           = var.cmr_username
        provider           = var.cmr_provider
        clientId           = var.cmr_client_id
        passwordSecretName = length(var.cmr_password) == 0 ? "" : aws_secretsmanager_secret.message_template_cmr_password.name
        cmrEnvironment     = var.cmr_environment
        cmrLimit           = var.cmr_limit
        cmrPageSize        = var.cmr_page_size
      }
      launchpad = {
        api         = var.launchpad_api
        certificate = var.launchpad_certificate
        passphraseSecretName = length(var.launchpad_passphrase) == 0 ? "" : aws_secretsmanager_secret.message_template_launchpad_passphrase.name
      }
      distribution_endpoint = var.distribution_url
      collection            = {}
      provider              = {}
      template              = "s3://${var.system_bucket}/${local.message_template_key}"
    }
    payload   = {}
    exception = null
  })
}

resource "aws_s3_bucket_object" "message_template" {
  bucket  = var.system_bucket
  key     = local.message_template_key
  content = local.message_template
  etag    = md5(local.message_template)
}

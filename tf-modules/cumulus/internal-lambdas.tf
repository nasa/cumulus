module "sqs_message_remover_lambda" {
  source = "../sqs-message-remover-lambda"

  prefix = var.prefix

  cmr_environment = var.cmr_environment

  system_bucket = var.system_bucket

  lambda_subnet_ids = var.lambda_subnet_ids
  security_group_ids = var.security_group_ids

  tags = var.tags

  # is this necessary or should we move towards least privileges
  # for the lambda?
  lambda_processing_role_arn = aws_iam_role.lambda_processing.name
}

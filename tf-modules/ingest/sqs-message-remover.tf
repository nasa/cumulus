module "sqs_message_remover_lambda" {
  source = "../../lambdas/sqs-message-remover"

  prefix = var.prefix

  system_bucket = var.system_bucket

  lambda_subnet_ids = var.lambda_subnet_ids
  # TODO: Create a local variable for security groups to use
  # throughout the ingest modiule
  security_group_ids = [
    aws_security_group.no_ingress_all_egress[0].id
  ]

  tags = var.tags

  # is this necessary or should we move towards least privileges
  # for the lambda?
  lambda_processing_role_arn = var.lambda_processing_role_arn
  lambda_timeouts       = var.lambda_timeouts
  lambda_memory_sizes   = var.lambda_memory_sizes
}

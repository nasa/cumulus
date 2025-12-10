resource "aws_lambda_function" "orca_copy_to_archive_adapter_task" {
  depends_on       = [aws_cloudwatch_log_group.orca_copy_to_archive_adapter_task]
  function_name    = "${var.prefix}-OrcaCopyToArchiveAdapter"
  filename         = "${path.module}/../../tasks/orca-copy-to-archive-adapter/dist/webpack/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/orca-copy-to-archive-adapter/dist/webpack/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs24.x"
  timeout          = lookup(var.lambda_timeouts, "OrcaCopyToArchiveAdapter", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "OrcaCopyToArchiveAdapter", 512)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
      orca_lambda_copy_to_archive_arn    = var.orca_lambda_copy_to_archive_arn
      orca_sfn_recovery_workflow_arn     = var.orca_sfn_recovery_workflow_arn
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

resource "aws_cloudwatch_log_group" "orca_copy_to_archive_adapter_task" {
  name = "/aws/lambda/${var.prefix}-OrcaCopyToArchiveAdapter"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "OrcaCopyToArchiveAdapter", var.default_log_retention_days)
  tags = var.tags
}

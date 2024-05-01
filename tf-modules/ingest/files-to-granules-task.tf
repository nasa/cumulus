resource "aws_lambda_function" "files_to_granules_task" {
  function_name    = "${var.prefix}-FilesToGranules"
  filename         = "${path.module}/../../tasks/files-to-granules/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/files-to-granules/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "FilesToGranules", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "FilesToGranules", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
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

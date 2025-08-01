resource "aws_lambda_function" "add_unique_granule_id_task" {
  function_name    = "${var.prefix}-AddUniqueGranuleId"
  filename         = "${path.module}/../../tasks/add-unique-granuleID/dist/webpack/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/add-unique-granuleID/dist/webpack/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "AddUniqueGranuleId", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "AddUniqueGranuleId", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CUMULUS_MESSAGE_ADAPTER_DIR       = "/opt/"
      stackName                         = var.prefix
      system_bucket                     = var.system_bucket
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

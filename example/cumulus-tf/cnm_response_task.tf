locals {
  cnm_response_version  = "2.0.3"
  cnm_response_filename = "cnmResponse-${local.cnm_response_version}.zip"
}

resource "null_resource" "get_cnmResponse" {
  triggers = {
    always_run = local.cnm_response_version
  }
  provisioner "local-exec" {
    command = "curl -s -L -o ${local.cnm_response_filename} https://github.com/podaac/cumulus-cnm-response-task/releases/download/v${local.cnm_response_version}/${local.cnm_response_filename}"
  }
}

resource aws_s3_bucket_object "cnm_response_lambda_zip" {
  depends_on = [null_resource.get_cnmResponse]
  bucket     = var.system_bucket
  key        = "${var.prefix}/${local.cnm_response_filename}"
  source     = local.cnm_response_filename
}

resource "aws_lambda_function" "cnm_response_task" {
  depends_on       = [aws_s3_bucket_object.cnm_response_lambda_zip]
  function_name    = "${var.prefix}-CnmResponse"
  s3_bucket        = var.system_bucket
  s3_key           = aws_s3_bucket_object.cnm_response_lambda_zip.id
  handler          = "gov.nasa.cumulus.CNMResponse::handleRequestStreams"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "java8"
  timeout          = 300
  memory_size      = 256
  source_code_hash = aws_s3_bucket_object.cnm_response_lambda_zip.etag

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
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "cnm_response_task" {
  name              = "/aws/lambda/${aws_lambda_function.cnm_response_task.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "cnmResponseTask_log_retention", var.default_log_retention_days)
  tags              = var.tags
}

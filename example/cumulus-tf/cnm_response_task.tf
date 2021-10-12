locals {
  cnm_response_version = "2.0.0"
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
  bucket = var.system_bucket
  key = local.cnm_response_filename
  source = local.cnm_response_filename
}

resource "aws_lambda_function" "cnm_response_task" {
  depends_on = [aws_s3_bucket_object.cnm_response_lambda_zip]
  function_name = "${var.prefix}-CnmResponse"
  filename      = aws_s3_bucket_object.cnm_response_lambda_zip.id
  handler       = "gov.nasa.cumulus.CNMResponse::handleRequestStreams"
  role          = module.cumulus.lambda_processing_role_arn
  runtime       = "java8"
  timeout       = 300
  memory_size   = 256
  source_code_hash = filebase64sha256(aws_s3_bucket_object.cnm_response_lambda_zip.id)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
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

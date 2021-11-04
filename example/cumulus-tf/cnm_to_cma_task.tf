locals {
  cnm_to_cma_version          = "1.4.2"
  cnm_to_cma_filename         = "cnmToGranule-${local.cnm_to_cma_version}.zip"
  path_to_cnm_to_cma_filename = "${path.module}/${local.cnm_to_cma_filename}"
}

resource "null_resource" "get_cnmToGranule" {
  triggers = {
    always_run = timestamp()
  }
  provisioner "local-exec" {
    command = "curl -s -L -o ${local.cnm_to_cma_filename} https://github.com/podaac/cumulus-cnm-to-granule/releases/download/v${local.cnm_to_cma_version}/${local.cnm_to_cma_filename}"
  }
}

resource "aws_lambda_function" "cnm_to_cma_task" {
  depends_on       = [null_resource.get_cnmToGranule]
  function_name    = "${var.prefix}-CNMToCMA"
  handler          = "gov.nasa.cumulus.CnmToGranuleHandler::handleRequestStreams"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "java8"
  timeout          = 300
  memory_size      = 128
  filename         = local.path_to_cnm_to_cma_filename
  source_code_hash = filebase64sha256(local.path_to_cnm_to_cma_filename)

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

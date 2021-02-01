resource "null_resource" "get_cnmToGranule" {
  triggers = {
    always_run = timestamp()
  }
  provisioner "local-exec" {
    command = "curl -s -L -o cnmToGranule.zip https://github.com/podaac/cumulus-cnm-to-granule/releases/download/v1.4.2/cnmToGranule-1.4.2.zip"
  }
}

resource "aws_lambda_function" "cnm_to_cma_task" {
  function_name = "${var.prefix}-CNMToCMA"
  depends_on    = [null_resource.get_cnmToGranule]
  filename      = "cnmToGranule.zip"
  handler       = "gov.nasa.cumulus.CnmToGranuleHandler::handleRequestStreams"
  role          = module.cumulus.lambda_processing_role_arn
  runtime       = "java8"
  timeout       = 300
  memory_size   = 128

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

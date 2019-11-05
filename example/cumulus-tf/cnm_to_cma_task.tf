resource "aws_lambda_function" "cnm_to_cma_task" {
  function_name = "${var.prefix}-CNMToCMA"
  s3_bucket     = "cumulus-data-shared"
  s3_key        = "daacs/podaac/cnmToGranule-1.2.1.zip"
  handler       = "gov.nasa.cumulus.CnmToGranuleHandler::handleRequestStreams"
  role          = module.cumulus.lambda_processing_role_arn
  runtime       = "java8"
  timeout       = 300
  memory_size   = 128

  layers = [var.cumulus_message_adapter_lambda_layer_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
    }
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.no_ingress_all_egress.id]
  }

  tags = merge(local.default_tags, { Project = var.prefix })
}

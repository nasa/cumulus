data "aws_lambda_function" "private_api_lambda" {
  function_name = "${var.prefix}-PrivateApiLambda"
}

module "granule_invalidator_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "GranuleInvalidatorWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/granule_invalidator_workflow.asl.json",
    {
      cumulus_internal_api_arn : data.aws_lambda_function.private_api_lambda.arn,
      granule_invalidator_arn : module.cumulus.granule_invalidator_task
    }
  )
}

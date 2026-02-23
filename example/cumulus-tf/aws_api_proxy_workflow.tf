module "aws_api_proxy_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "AwsApiProxyWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/aws_api_proxy_workflow.asl.json",
    {
      aws_api_proxy_arn = module.cumulus.aws_api_proxy_arn
    }
  )
}

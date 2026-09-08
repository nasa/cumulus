module "get_cnm_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "GetCnmWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/get_cnm_workflow.asl.json",
    {
      get_cnm_arn : module.cumulus.get_cnm_task.task_arn
    }
  )
}

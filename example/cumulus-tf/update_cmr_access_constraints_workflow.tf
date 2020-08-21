module "update_cmr_access_constraints_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "UpdateCmrAccessConstraintsWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/update_cmr_access_constraints_workflow.asl.json",
    {
      update_cmr_access_constraints_task_arn: module.cumulus.update_cmr_access_constraints_task.task_arn,
      post_to_cmr_task_arn: module.cumulus.post_to_cmr_task.task_arn
    }
  )
}

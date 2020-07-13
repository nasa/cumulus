module "sync_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "SyncGranule"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/sync_granule_workflow.asl.json",
    {
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn
    }
  )
}

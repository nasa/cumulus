module "sync_granule_catch_duplicate_error_test" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "SyncGranuleCatchDuplicateErrorTest"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/sync_granule_catch_duplicate_error_test_workflow.asl.json",
    {
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn
    }
  )
}

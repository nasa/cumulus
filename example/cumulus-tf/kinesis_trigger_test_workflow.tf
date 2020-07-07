module "kinesis_trigger_test_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "KinesisTriggerTest"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/kinesis_trigger_test_workflow.asl.json",
    {
      cnm_to_cma_task_arn: module.cumulus.cnm_to_cma_task.task_arn,
      cma_repsonse_task_arn: module.cumulus.cma_repsonse_task.task_arn,
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn
    }
  )
}

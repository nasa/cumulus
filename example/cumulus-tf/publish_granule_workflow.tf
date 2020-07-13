module "publish_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "PublishGranule"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/publish_granule_workflow.asl.json",
    {
      post_to_cmr_task_arn: module.cumulus.post_to_cmr_task.task_arn
    }
  )
}

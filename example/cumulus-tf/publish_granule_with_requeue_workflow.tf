module "publish_granule_queue_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "PublishGranuleQueue"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/publish_granule_with_requeue_workflow.asl.json",
    {
      post_to_cmr_task_arn: module.cumulus.post_to_cmr_task.task_arn,
      queue_workflow_task_arn: module.cumulus.queue_workflow_task.task_arn,
      start_sf_queue_url: module.cumulus.start_sf_queue_url
    }
  )
}

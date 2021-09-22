module "discover_granules_background_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "DiscoverGranulesBackground"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/discover_granules_background_workflow.asl.json",
    {
      ingest_granule_workflow_name: module.ingest_granule_workflow.name,
      discover_granules_task_arn: module.cumulus.discover_granules_task.task_arn,
      queue_granules_task_arn: module.cumulus.queue_granules_task.task_arn,
      background_queue_url: module.cumulus.background_queue_url,
    }
  )
}

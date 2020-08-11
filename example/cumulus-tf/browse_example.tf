module "discover_granules_browse_example_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "DiscoverGranulesBrowseExample"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/browse_example.asl.json",
    {
      discover_granules_task_arn: module.cumulus.discover_granules_task.task_arn,
      queue_granules_task_arn: module.cumulus.queue_granules_task.task_arn,
      start_sf_queue_url: module.cumulus.start_sf_queue_url
    }
  )
}

module "queue_granules_passthrough_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "QueueGranulesPassthrough"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/queue_granules_passthrough_workflow.asl.json",
    {
      ingest_granule_workflow_name: module.passthrough_workflow.name,
      queue_granules_task_arn: module.cumulus.queue_granules_task.task_arn,
      start_sf_queue_url: module.cumulus.start_sf_queue_url
    }
  )
}

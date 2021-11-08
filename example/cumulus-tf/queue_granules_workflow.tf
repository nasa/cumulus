module "queue_granules_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "QueueGranules"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/queue_granules_workflow.asl.json",
    {
      ingest_granule_workflow_name: module.ingest_granule_workflow.name,
      queue_granules_task_arn: module.cumulus.queue_granules_task.task_arn,
    }
  )
}

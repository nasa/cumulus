module "discover_granules_to_throttled_queue_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "DiscoverGranulesToThrottledQueue"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/discover_granules_to_throttled_queue_workflow.asl.json",
    {
      ingest_granule_workflow_name: module.ingest_granule_workflow.name,
      discover_granules_task_arn: module.cumulus.discover_granules_task.task_arn,
      queue_granules_task_arn: module.cumulus.queue_granules_task.task_arn,
      throttled_queue_url: aws_sqs_queue.throttled_queue.id
    }
  )
}

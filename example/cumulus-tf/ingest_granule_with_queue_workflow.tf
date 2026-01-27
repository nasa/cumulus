module "ingest_granule_queue_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "IngestGranuleQueue"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/ingest_granule_with_queue_workflow.asl.json",
    {
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn,
      fake_processing_task_arn: module.cumulus.fake_processing_task.task_arn,
      files_to_granules_task_arn: module.cumulus.files_to_granules_task.task_arn,
      move_granules_task_arn: module.cumulus.move_granules_task.task_arn,
      update_granules_cmr_metadata_file_links_task_arn: module.cumulus.update_granules_cmr_metadata_file_links_task.task_arn,
      queue_workflow_task_arn: module.cumulus.queue_workflow_task.task_arn,
      start_sf_queue_url: module.cumulus.start_sf_queue_url
    }
  )
}

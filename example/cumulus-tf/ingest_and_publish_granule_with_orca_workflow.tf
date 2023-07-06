module "ingest_and_publish_granule_with_orca_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "IngestAndPublishGranuleWithOrca"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/ingest_and_publish_granule_with_orca_workflow.asl.json",
    {
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn,
      add_missing_file_checksums_task_arn: module.cumulus.add_missing_file_checksums_task.task_arn,
      fake_processing_task_arn: module.cumulus.fake_processing_task.task_arn,
      files_to_granules_task_arn: module.cumulus.files_to_granules_task.task_arn,
      move_granules_task_arn: module.cumulus.move_granules_task.task_arn,
      update_granules_cmr_metadata_file_links_task_arn: module.cumulus.update_granules_cmr_metadata_file_links_task.task_arn,
      hyrax_metadata_updates_task_arn: module.cumulus.hyrax_metadata_updates_task.task_arn,
      lzards_backup_task_arn: module.cumulus.lzards_backup_task.task_arn,
      post_to_cmr_task_arn: module.cumulus.post_to_cmr_task.task_arn,
    }
  )
}

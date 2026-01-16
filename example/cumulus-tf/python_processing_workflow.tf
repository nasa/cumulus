module "python_test_ingest_processing_service" {
  source = "../lambdas/python-processing/deploy"

  aws_region = data.aws_region.current.name
  prefix = var.prefix
  tags   = local.tags

  cloudwatch_log_retention_periods               = var.cloudwatch_log_retention_periods
  default_log_retention_days                     = var.default_log_retention_days

  cumulus_ecs_cluster_arn                        = module.cumulus.ecs_cluster_arn
  cumulus_test_ingest_image_version              = var.cumulus_test_ingest_image_version
}

module "python_test_python_processing_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "TestPythonProcessing"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/python_processing_workflow.asl.json",
    {
      files_to_granules_task_arn: module.cumulus.files_to_granules_task.task_arn,
      move_granules_task_arn: module.cumulus.move_granules_task.task_arn,
      update_granules_cmr_metadata_file_links_task_arn: module.cumulus.update_granules_cmr_metadata_file_links_task.task_arn,
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn,
      python_test_ingest_processing_service_id: module.python_test_ingest_processing_service.activity_id
    }
  )
}

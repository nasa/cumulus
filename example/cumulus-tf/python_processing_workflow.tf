resource "aws_sfn_activity" "ecs_task_python_test_ingest_processing_service" {
  name = "${var.prefix}-EcsTaskPythonIngestProcessingProcess"
  tags = local.tags
}


data "aws_ecr_repository" "cumulus_test_ingest_process" {
  name = "cumulus-test-ingest-process"
}

module "python_test_ingest_processing_service" {
  source = "../../tf-modules/cumulus_ecs_service"
  default_log_retention_days                     = var.default_log_retention_days
  cloudwatch_log_retention_periods               = var.cloudwatch_log_retention_periods
  prefix = var.prefix
  name   = "PythonTestIngestProcess"
  tags   = local.tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "${data.aws_ecr_repository.cumulus_test_ingest_process.repository_url}:${var.cumulus_test_ingest_image_version}"

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
    ACTIVITY_ARN = aws_sfn_activity.ecs_task_python_test_ingest_processing_service.id
  }
  command = [
    "python",
    "src/task.py"
  ]
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
      python_test_ingest_processing_service_id: aws_sfn_activity.ecs_task_python_test_ingest_processing_service.id
    }
  )
}

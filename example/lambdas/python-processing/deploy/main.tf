resource "aws_sfn_activity" "ecs_task_python_test_ingest_processing_service" {
  name = "${var.prefix}-EcsTaskPythonIngestProcessingProcess"
  tags = var.tags
}

data "aws_ecr_repository" "cumulus_test_ingest_process" {
  name = "cumulus-test-ingest-process"
}

module "python_test_ingest_processing_service" {
  source = "../../../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "PythonTestIngestProcess"
  tags   = var.tags
  default_log_retention_days                     = var.default_log_retention_days
  cloudwatch_log_retention_periods               = var.cloudwatch_log_retention_periods

  cluster_arn                           = var.cumulus_ecs_cluster_arn
  desired_count                         = 1
  image                                 = "${data.aws_ecr_repository.cumulus_test_ingest_process.repository_url}:${var.cumulus_test_ingest_image_version}"

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = var.aws_region.current.name
    ACTIVITY_ARN = aws_sfn_activity.ecs_task_python_test_ingest_processing_service.id
  }
  command = [
    "python",
    "src/task.py"
  ]
}

resource "aws_sfn_activity" "ecs_task_python_processing_service" {
  name = "${var.prefix}-EcsTaskPythonProcess"
  tags = var.tags
}

data "aws_ecr_repository" "cumulus_process_activity" {
  name = "cumulus-process-activity"
}

module "python_processing_service" {
  source = "../../../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "PythonProcess-v2"
  tags   = var.tags

  cluster_arn                           = var.cumulus_ecs_cluster_arn
  desired_count                         = 1
  image                                 = "${data.aws_ecr_repository.cumulus_process_activity.repository_url}:${var.cumulus_process_activity_version}"

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = var.aws_region
    ACTIVITY_ARN = aws_sfn_activity.ecs_task_python_processing_service.id
  }

  command = [
    "python",
    "src/task.py"
  ]
}

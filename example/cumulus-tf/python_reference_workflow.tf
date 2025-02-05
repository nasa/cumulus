
resource "aws_sfn_activity" "ecs_task_python_processing_service" {
  name = "${var.prefix}-EcsTaskPythonProcess"
  tags = local.tags
}

data "aws_ecr_repository" "cumulus_process_activity" {
  name = "cumulus-process-activity"
}

module "python_processing_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "PythonProcess"
  tags   = local.tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "${data.aws_ecr_repository.cumulus_process_activity.repository_url}:${var.cumulus_process_activity_version}"

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
    ACTIVITY_ARN = aws_sfn_activity.ecs_task_python_processing_service.id
  }
  command = [
    "/usr/local/bin/python",
    "process_activity.py"
  ]
}

module "python_reference_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "PythonReferenceWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/python_reference_workflow.asl.json",
    {
      python_reference_task_arn: aws_lambda_function.python_reference_task.arn,
      python_processing_service_id: aws_sfn_activity.ecs_task_python_processing_service.id
    }
  )
}

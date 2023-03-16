resource "aws_sfn_activity" "ecs_task_hello_world" {
  name = "${var.prefix}-EcsTaskHelloWorld"
  tags = local.tags
}



data "aws_ecr_repository" "ecs_task_image" {
  name = "cumulus-ecs-task"
}

module "hello_world_service" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "HelloWorld"
  tags   = local.tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "${data.aws_ecr_repository.ecs_task_image.repository_url}:${var.ecs_task_image_version}"

  cpu                = 400
  memory_reservation = 700

  default_log_retention_days                     = var.default_log_retention_days
  cloudwatch_log_retention_periods               = var.cloudwatch_log_retention_periods

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
  }
  command = [
    "cumulus-ecs-task",
    "--activityArn",
    aws_sfn_activity.ecs_task_hello_world.id,
    "--lambdaArn",
    module.cumulus.hello_world_task.task_arn,
    "--lastModified",
    module.cumulus.hello_world_task.last_modified_date
  ]
}

module "ecs_hello_world_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "EcsHelloWorldWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags


  state_machine_definition = templatefile(
    "${path.module}/ecs_hello_world_workflow.asl.json",
    {
      ecs_task_hello_world_activity_id: aws_sfn_activity.ecs_task_hello_world.id
    }
  )
}

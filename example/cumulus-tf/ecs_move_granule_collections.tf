resource "aws_sfn_activity" "ecs_task_move_granule_collections" {
  name = "${var.prefix}-EcsTaskHelloWorld"
  tags = local.tags
}

data "aws_ecr_repository" "ecs_task_image" {
  name = "cumulus-ecs-task"
}

module "moge_granule_collections_services" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "moveGranuleCollections"
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
    aws_sfn_activity.ecs_task_move_granule_collections.id,
    "--lambdaArn",
    module.cumulus.move_granule_collections_task.task_arn,
    "--lastModified",
    module.cumulus.move_granule_collections_task.last_modified_date
  ]
}


module "ecs_move_granule_collections" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "ECSMoveGranuleCollectionsWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags


  state_machine_definition = templatefile(
    "${path.module}/ecs_move_granule_collections.asl.json",
    {
      ecs_task_move_granule_collections: aws_sfn_activity.move_granule_collections_ecs_task_id
    }
  )
}



module "move_granule_collections_service" {
  source      = "../../tf-modules/cumulus_ecs_service"
  prefix      = var.prefix
  name        = "MoveGranuleCollections"
  cluster_arn = var.cumulus.ecs_cluster_arn
  image       = "${data.aws_ecr_repository.ecs_task_image.repository_url}:${var.ecs_task_image_version}"

  desired_count      = 1
  cpu                = 400
  memory_reservation = 700

  default_log_retention_days       = var.default_log_retention_days
  cloudwatch_log_retention_periods = var.cloudwatch_log_retention_periods

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
  }
  command = [
    "cumulus-ecs-task",
    "--activityArn",
    aws_sfn_activity.move_granule_collections_ecs_task.id,
    "--lambdaArn",
    module.cumulus.move_granule_collections_task.task_arn,
    "--lastModified",
    module.cumulus.move_granule_collections_task.last_modified_date
  ]
}
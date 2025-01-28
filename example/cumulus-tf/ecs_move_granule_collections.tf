resource "aws_sfn_activity" "ecs_task_change_granule_collection_s3" {
  name = "${var.prefix}-EcsTaskChangeGranuleCollectionS3s"
  tags = local.tags
}

module "change_granule_collection_s3_services" {
  source = "../../tf-modules/cumulus_ecs_service"

  prefix = var.prefix
  name   = "ChangeGranuleCollectionS3s"
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
    stackName = var.prefix
  }
  command = [
    "cumulus-ecs-task",
    "--activityArn",
    aws_sfn_activity.ecs_task_change_granule_collection_s3.id,
    "--lambdaArn",
    module.cumulus.change_granule_collection_s3_task.task_arn,
    "--lastModified",
    module.cumulus.change_granule_collection_s3_task.last_modified_date
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
      change_granule_collection_s3_task_arn: module.cumulus.change_granule_collection_s3.task_arn
    }
  )
}

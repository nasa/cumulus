resource "aws_lambda_function" "move_granule_collections_task" {
  function_name    = "${var.prefix}-MoveGranuleCollections"
  filename         = "${path.module}/../../tasks/move-granule-collections/dist/webpack/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/move-granule-collections/dist/webpack/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs20.x"
  timeout          = lookup(var.lambda_timeouts, "MoveGranuleCollections", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "MoveGranuleCollections", 1024)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT                   = var.cmr_environment
      CMR_HOST                          = var.cmr_custom_host
      CUMULUS_MESSAGE_ADAPTER_DIR       = "/opt/"
      default_s3_multipart_chunksize_mb = var.default_s3_multipart_chunksize_mb
      stackName                         = var.prefix
      system_bucket                     = var.system_bucket
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }

  tags = var.tags
}

resource "aws_sfn_activity" "move_granule_collections_ecs_task" {
  name = "${var.prefix}-MoveGranuleCollections"
  tags = var.tags
}

data "aws_ecr_repository" "ecs_task_image" {
  name = "cumulus-ecs-task"
}

module "move_granule_collections_service" {
  source      = "../cumulus_ecs_service"
  prefix      = var.prefix
  name        = "MoveGranuleCollections"
  cluster_arn = var.ecs_cluster_arn
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
    move_granule_collections_task.task_arn,
    "--lastModified",
    move_granule_collections_task.last_modified_date
  ]
}
# Runs via ecs:runTask.sync and always exits non-zero, so Step Functions
# deterministically records a "TaskFailed" event in the execution history.
resource "aws_ecs_task_definition" "ecs_failing_task" {
  family                   = "${var.prefix}-EcsFailingTask"
  requires_compatibilities = ["EC2"]
  network_mode             = "bridge"
  tags                     = local.tags

  container_definitions = jsonencode([
    {
      name              = "EcsFailingTask"
      image             = "${data.aws_ecr_repository.ecs_task_image.repository_url}:${var.ecs_task_image_version}"
      cpu               = 100
      memoryReservation = 256
      essential         = true
      command           = ["sh", "-c", "exit 1"]
    }
  ])
}

module "ecs_failing_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "EcsFailWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags


  state_machine_definition = templatefile(
    "${path.module}/ecs_failing_workflow.asl.json",
    {
      ecs_cluster_arn         = module.cumulus.ecs_cluster_arn
      ecs_task_definition_arn = aws_ecs_task_definition.ecs_failing_task.arn
    }
  )
}

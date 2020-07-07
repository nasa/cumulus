module "retry_pass_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "RetryPassWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/retry_pass_workflow.asl.json",
    {
      hello_world_task_arn: module.cumulus.hello_world_task.task_arn
    }
  )
}

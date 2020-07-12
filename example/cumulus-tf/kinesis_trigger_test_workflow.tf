module "kinesis_trigger_test_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "KinesisTriggerTest"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/kinesis_trigger_test_workflow.asl.json",
    {
      cnm_to_cma_task_arn: aws_lambda_function.cnm_to_cma_task.arn,
      cnm_response_task_arn: aws_lambda_function.cnm_response_task.arn,
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn
    }
  )
}

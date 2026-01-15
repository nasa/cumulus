module "python_processing_service" {
  source = "../lambdas/python-reference-activity/deploy"

  prefix = var.prefix
  tags   = local.tags

  cumulus_ecs_cluster_arn                           = module.cumulus.ecs_cluster_arn
  cumulus_process_activity_version                  = var.cumulus_process_activity_version
}

module "python_reference_task" {
  source = "../lambdas/python-reference-task/deploy"

  prefix                                         = var.prefix
  lambda_processing_role_arn                     = module.cumulus.lambda_processing_role_arn
  cumulus_message_adapter_lambda_layer_version_arn = var.cumulus_message_adapter_lambda_layer_version_arn
  lambda_subnet_ids                              = var.lambda_subnet_ids
  lambda_security_group_id                       = aws_security_group.no_ingress_all_egress.id
  tags                                           = local.tags
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
      python_reference_task_arn: module.python_reference_task.lambda_function_arn,
      python_processing_service_id: aws_sfn_activity.ecs_task_python_processing_service.id
    }
  )
}

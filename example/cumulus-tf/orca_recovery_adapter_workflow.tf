module "orca_recovery_adapter_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "OrcaRecoveryAdapterWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/orca_recovery_adapter_workflow.asl.json",
    {
      orca_recovery_adapter_task: module.cumulus.orca_recovery_adapter_task.task_arn
    }
  )
}

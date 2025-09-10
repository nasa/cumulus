module "cnm_workflow" {
  depends_on = [
    aws_lambda_function.cnm_response_task,
    aws_lambda_function.cnm_to_cma_task
  ]

  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "CNMExampleWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/cnm_workflow.asl.json",
    {
      add_unique_granule_id_arn: module.cumulus.add_unique_granule_id_task.task_arn,
      cnm_to_cma_task_arn: aws_lambda_function.cnm_to_cma_task.arn,
      cnm_response_task_arn: aws_lambda_function.cnm_response_task.arn,
      fake_processing_task_arn: module.cumulus.fake_processing_task.task_arn,
      files_to_granules_task_arn: module.cumulus.files_to_granules_task.task_arn,
      hyrax_metadata_updates_task_arn: module.cumulus.hyrax_metadata_updates_task.task_arn,
      move_granules_task_arn: module.cumulus.move_granules_task.task_arn,
      post_to_cmr_task_arn: module.cumulus.post_to_cmr_task.task_arn,
      sync_granule_task_arn: module.cumulus.sync_granule_task.task_arn,
      update_granules_cmr_metadata_file_links_task_arn: module.cumulus.update_granules_cmr_metadata_file_links_task.task_arn
    }
  )
}

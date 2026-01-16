module "change_granule_collections_workflow" {
  source = "../workflow"

  prefix          = var.prefix
  name            = "ChangeGranuleCollectionsWorkflow"
  workflow_config = var.workflow_config
  system_bucket   = var.system_bucket
  tags            = var.tags


  state_machine_definition = templatefile(
    "${path.module}/change_granule_collections_workflow.asl.json",
    {
      change_granule_collection_s3_task_arn: var.change_granule_collection_s3_task_arn
      post_to_cmr_task_arn:                  var.post_to_cmr_task_arn
      change_granule_collection_pg_task_arn: var.change_granule_collection_pg_task_arn
    }
  )
}

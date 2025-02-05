module "move_granule_collections_workflow" {
  source = "../workflow"

  prefix          = var.prefix
  name            = "MoveGranuleCollectionsWorkflow"
  workflow_config = var.workflow_config
  system_bucket   = var.system_bucket
  tags            = var.tags


  state_machine_definition = templatefile(
    "${path.module}/move_granule_collections_workflow.asl.json",
    {
      change_granule_collection_s3_task_arn: var.change_granule_collection_s3_task_arn
    }
  )
}
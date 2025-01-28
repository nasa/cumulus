module "move_granule_collections_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "MoveGranuleCollectionsWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags


  state_machine_definition = templatefile(
    "${path.module}/move_granule_collections_workflow.asl.json",
    {
      change_granule_collection_s3_task_arn: module.ingest.change_granule_collection_s3_task.task_arn
    }
  )
}

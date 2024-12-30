module "ecs_move_granule_collections" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "ECSMoveGranuleCollectionsWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags


  state_machine_definition = templatefile(
    "${path.module}/ecs_move_granule_collections.asl.json",
    {
      ecs_task_move_granule_collections: data.terraform_remote_state.ingest.outputs.move_granule_collections_ecs_task_id
    }
  )
}

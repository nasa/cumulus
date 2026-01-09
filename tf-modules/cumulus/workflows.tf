module "change_granule_collections_workflow" {
  count = var.deploy_cumulus_workflows.change_granule_collections_workflow ? 1 : 0
  source = "../workflows"

  prefix          = var.prefix
  system_bucket   = var.system_bucket
  tags            = var.tags
  workflow_config = local.workflow_config
  change_granule_collection_s3_task_arn = module.ingest.change_granule_collection_s3_task.task_arn
  post_to_cmr_task_arn                  = module.ingest.post_to_cmr_task.task_arn
  change_granule_collection_pg_task_arn = module.ingest.change_granule_collection_pg_task.task_arn
}

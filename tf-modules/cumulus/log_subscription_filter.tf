module "log_subscription_filter" {
  source = "../log-subscription-filter"

  prefix                                = var.prefix
  log_destination_arn                   = var.log_destination_arn
  additional_log_groups_to_elk          = var.additional_log_groups_to_elk
  log2elasticsearch_lambda_function_arn = module.archive.log2elasticsearch_lambda_function_arn
  logs_to_metrics                       = var.logs_to_metrics

  # Ingest Log Groups
  discover_pdrs_task = module.ingest.discover_pdrs_task.task_log_group
  parse_pdr_task     = module.ingest.parse_pdr_task.task_log_group
  post_to_cmr_task   = module.ingest.post_to_cmr_task.task_log_group
  queue_pdrs_task    = module.ingest.queue_pdrs_task.task_log_group
  sync_granule_task  = module.ingest.sync_granule_task.task_log_group

  # Async Operation Log Group
  async_operation_log_group = module.archive.async_operation_log_group
}

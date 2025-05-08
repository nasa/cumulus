module "parse_pdr_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "ParsePdr"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/parse_pdr_workflow.asl.json",
    {
      ingest_workflow_name: module.ingest_granule_workflow.name,
      parse_pdr_task_arn: module.cumulus.parse_pdr_task.task_arn,
      pdr_status_check_task_arn: module.cumulus.pdr_status_check_task.task_arn,
      queue_granules_task_arn: module.cumulus.queue_granules_task.task_arn,
      send_pan_arn: module.cumulus.send_pan_task.task_arn,
      sf_sqs_report_task_arn: module.cumulus.sf_sqs_report_task.task_arn,
      start_sf_queue_url: module.cumulus.start_sf_queue_url
    }
  )
}
module "parse_pdr_workflow_unique" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "ParsePdrUnique"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/parse_pdr_workflow_unique.asl.json",
    {
      ingest_workflow_name: module.ingest_granule_workflow.name,
      parse_pdr_task_arn: module.cumulus.parse_pdr_task.task_arn,
      pdr_status_check_task_arn: module.cumulus.pdr_status_check_task.task_arn,
      queue_granules_task_arn: module.cumulus.queue_granules_task.task_arn,
      send_pan_arn: module.cumulus.send_pan_task.task_arn,
      sf_sqs_report_task_arn: module.cumulus.sf_sqs_report_task.task_arn,
      start_sf_queue_url: module.cumulus.start_sf_queue_url
    }
  )
}

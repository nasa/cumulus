module "report_executions" {
  source = "../report-executions"

  prefix               = var.prefix
  executions_table     = var.executions_table
  permissions_boundary = var.permissions_boundary
}

module "report_granules" {
  source = "../report-granules"

  prefix               = var.prefix
  granules_table       = var.granules_table
  permissions_boundary = var.permissions_boundary
}

module "report_pdrs" {
  source = "../report-pdrs"

  prefix               = var.prefix
  pdrs_table           = var.pdrs_table
  permissions_boundary = var.permissions_boundary
}

module "publish_reports" {
  source = "../publish-reports"

  prefix                  = var.prefix
  execution_sns_topic_arn = module.report_executions.execution_sns_arn
  granule_sns_topic_arn   = module.report_granules.granule_sns_arn
  pdr_sns_topic_arn       = module.report_pdrs.pdr_sns_arn
  state_machine_arns      = var.state_machine_arns
  permissions_boundary    = var.permissions_boundary
}

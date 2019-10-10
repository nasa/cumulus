module "report_granules" {
  source = "../report-granules"

  prefix         = var.prefix
  granules_table = var.dynamo_tables.granules.name

  permissions_boundary = var.permissions_boundary_arn
  subnet_ids           = var.lambda_subnet_ids
  security_groups      = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
}

module "report_pdrs" {
  source = "../report-pdrs"

  prefix     = var.prefix
  pdrs_table = var.dynamo_tables.pdrs.name

  permissions_boundary = var.permissions_boundary_arn
  subnet_ids           = var.lambda_subnet_ids
  security_groups      = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
}

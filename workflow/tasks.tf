module "cnm_to_granules_task" {
  source = "https://github.com/asfadmin/cumulus-task-cnm-to-granules/releases/download/v1.1.1/terraform-cnm-to-granules.zip"

  prefix = var.PREFIX

  lambda_subnet_ids          = local.lambda_subnet_ids
  lambda_security_group_ids  = local.lambda_security_group_ids
  lambda_processing_role_arn = local.lambda_processing_role_arn
}

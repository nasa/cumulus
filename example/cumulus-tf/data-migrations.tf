module "data_migration" {
  source = "../../tf-modules/dynamo-to-pg-data-migration"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  dynamo_tables = data.terraform_remote_state.data_persistence.outputs.dynamo_tables

  rds_security_group_id = data.terraform_remote_state.data_persistence.outputs.rds_security_group
  rds_user_access_secret_arn = data.terraform_remote_state.data_persistence.outputs.database_credentials_secret_arn

  provider_kms_key_id = module.cumulus.provider_kms_key_id

  tags = merge(var.tags, { Deployment = var.prefix })
}

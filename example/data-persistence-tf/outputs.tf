
output "dynamo_tables" {
  value = module.data_persistence.dynamo_tables
}

output "database_credentials_secret_arn" {
  # lp stack uses postgres as user database
  value = var.rds_admin_access_secret_arn
}

output "rds_security_group" {
  value = var.rds_security_group
}



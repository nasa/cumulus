
output "dynamo_tables" {
  value = module.data_persistence.dynamo_tables
}

output "elasticsearch_domain_arn" {
  value = module.data_persistence.elasticsearch_domain_arn
}

output "elasticsearch_hostname" {
  value = module.data_persistence.elasticsearch_hostname
}

output "elasticsearch_security_group_id" {
  value = module.data_persistence.elasticsearch_security_group_id
}

output "elasticsearch_alarms" {
  value = module.data_persistence.elasticsearch_alarms
}

output "database_credentials_secret_arn" {
  value = module.provision_database.database_credentials_secret_arn
}

output "rds_security_group" {
  value = var.rds_security_group
}



output "security_group_id" {
  value = module.rds_cluster.security_group_id
}

output "rds_endpoint" {
  value = module.rds_cluster.rds_endpoint
}

output "rds_reader_endpoint" {
  value = module.rds_cluster.rds_reader_endpoint
}

output "admin_db_login_secret_arn" {
  value = module.rds_cluster.admin_db_login_secret_arn
}

output "admin_db_login_secret_version" {
  value = module.rds_cluster.admin_db_login_secret_version
}

output "security_group_id" {
  value = module.rds_cluster.security_group_id
}

output "rds_endpoint" {
  value = module.rds_cluster.rds_endpoint
}

output "secret_arn" {
  value = module.rds_cluster.secret_arn
}

output "secret_version" {
  value = module.rds_cluster.secret_version
}

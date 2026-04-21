output "iceberg_replication_cluster_arn" {
  description = "The ARN of the ECS cluster created by this module"
  value = module.rds_iceberg_replication.iceberg_replication_cluster_arn
}

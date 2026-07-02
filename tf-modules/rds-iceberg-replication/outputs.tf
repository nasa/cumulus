output "iceberg_replication_cluster_arn" {
  description = "ARN of the ECS Fargate cluster used for Iceberg replication"
  value       = var.enable_iceberg_replication ? module.cluster[0].replication_ecs_cluster.arn : null
}

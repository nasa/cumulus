output "iceberg_replication_cluster_arn" {
  description = "ARN of the ECS Fargate cluster used for Iceberg replication"
  value = module.cluster.replication_ecs_cluster.arn
}

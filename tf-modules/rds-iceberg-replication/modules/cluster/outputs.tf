output "task_execution_role" {
  description = "IAM role used by Docker daemon and ECS container agent"
  value       = aws_iam_role.ecs_task_execution_role
}

output "no_ingress_all_egress_security_group" {
  description = "Security group to use for tasks that prevents outside access while allowing containers to contact external services"
  value       = aws_security_group.no_ingress_all_egress
}

output "replication_ecs_cluster" {
  description = "The ARN of the ECS cluster created by this module"
  value       = aws_ecs_cluster.default
}

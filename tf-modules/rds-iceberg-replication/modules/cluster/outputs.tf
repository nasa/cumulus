output "task_execution_role" {
  description = "IAM role used by Docker daemon and ECS container agent"
  value = aws_iam_role.ecs_task_execution_role
}

output "fargate_task_role" {
  description = "IAM role used to allow task containers to access AWS services"
  value = aws_iam_role.fargate_task_role
}

output "ecs_infrastructure_role"  {
  description = "IAM role used to provide access to EBS volumes"
  value = aws_iam_role.ecs_infrastructure_role
}

output "no_ingress_all_egress_security_group" {
  description = "Security group to use for tasks that prevents outside access while allowing containers to contact external services"
  value = aws_security_group.no_ingress_all_egress
}

output "replication_ecs_cluster" {
  description = "The ARN of the ECS cluster created by this module"
  value = aws_ecs_cluster.default
}

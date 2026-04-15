output "task_execution_role" {
  value = aws_iam_role.ecs_task_execution_role
}

output "task_role" {
  value = aws_iam_role.fargate_task_role
}

output "ecs_infrastructure_role"  {
  value = aws_iam_role.ecs_infrastructure_role
}

output "no_ingress_all_egress_security_group" {
  value = aws_security_group.no_ingress_all_egress
}

output "replication_ecs_cluster" {
  value = aws_ecs_cluster.default
}

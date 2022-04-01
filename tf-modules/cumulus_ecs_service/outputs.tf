output "service_name" {
  value = var.use_fargate ? aws_ecs_service.fargate[0].name : aws_ecs_service.default[0].name
}

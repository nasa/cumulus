output "activity_arn" {
  description = "ARN of the Step Functions activity"
  value       = aws_sfn_activity.ecs_task_python_processing_service.id
}

output "activity_id" {
  description = "ID of the Step Functions activity"
  value       = aws_sfn_activity.ecs_task_python_processing_service.id
}

output "service_name" {
  description = "Name of the ECS service"
  value       = module.python_processing_service.service_name
}

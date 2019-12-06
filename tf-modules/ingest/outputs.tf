output "discover_granules_task" {
  value = {
    task_arn = aws_lambda_function.discover_granules_task.arn
  }
}

output "discover_pdrs_task" {
  value = {
    task_arn = aws_lambda_function.discover_pdrs_task.arn
  }
}

output "fake_processing_task" {
  value = {
    task_arn = aws_lambda_function.fake_processing_task.arn
  }
}

output "files_to_granules_task" {
  value = {
    task_arn = aws_lambda_function.files_to_granules_task.arn
  }
}

output "hello_world_task" {
  value = {
    task_arn = aws_lambda_function.hello_world_task.arn
  }
}

output "kinesis_fallback_topic_arn" {
  value = aws_sns_topic.kinesis_fallback.arn
}

output "kinesis_inbound_event_logger_lambda_function_arn" {
  value = aws_lambda_function.kinesis_inbound_event_logger.arn
}

output "manual_consumer_lambda_function_arn" {
  value = aws_lambda_function.manual_consumer.arn
}

output "message_consumer_lambda_function_arn" {
  value = aws_lambda_function.message_consumer.arn
}

output "move_granules_task" {
  value = {
    task_arn = aws_lambda_function.move_granules_task.arn
  }
}

output "parse_pdr_task" {
  value = {
    task_arn = aws_lambda_function.parse_pdr_task.arn
  }
}

output "pdr_status_check_task" {
  value = {
    task_arn = aws_lambda_function.pdr_status_check_task.arn
  }
}

output "post_to_cmr_task" {
  value = {
    task_arn = aws_lambda_function.post_to_cmr_task.arn
  }
}

output "queue_granules_task" {
  value = {
    task_arn = aws_lambda_function.queue_granules_task.arn
  }
}

output "queue_pdrs_task" {
  value = {
    task_arn = aws_lambda_function.queue_pdrs_task.arn
  }
}

output "schedule_sf_lambda_function_arn" {
  value = aws_lambda_function.schedule_sf.arn
}

output "sf_sns_report_task" {
  value = {
    task_arn = aws_lambda_function.sf_sns_report_task.arn
  }
}

output "sf_semaphore_down_lambda_function_arn" {
  value = aws_lambda_function.sf_semaphore_down.arn
}

output "sqs_message_remover_lambda_function_arn" {
  value = aws_lambda_function.sqs_message_remover.arn
}

output "sqs2sfThrottle_lambda_function_arn" {
  value = aws_lambda_function.sqs2sfThrottle.arn
}

output "sync_granule_task" {
  value = {
    task_arn = aws_lambda_function.sync_granule_task.arn
  }
}

output "step_role_arn" {
  value = aws_iam_role.step.arn
}

output "scaling_role_arn" {
  value = aws_iam_role.scaling.arn
}

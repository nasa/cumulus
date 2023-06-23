output "add_missing_file_checksums_task" {
  value = {
    task_arn           = aws_lambda_function.add_missing_file_checksums_task.arn
    last_modified_date = aws_lambda_function.add_missing_file_checksums_task.last_modified
  }
}

output "discover_granules_task" {
  value = {
    task_arn           = aws_lambda_function.discover_granules_task.arn
    last_modified_date = aws_lambda_function.discover_granules_task.last_modified
  }
}

output "discover_pdrs_task" {
  value = {
    task_arn           = aws_lambda_function.discover_pdrs_task.arn
    task_log_group     = aws_cloudwatch_log_group.discover_pdrs_task.name
    last_modified_date = aws_lambda_function.discover_pdrs_task.last_modified
  }
}

output "fake_processing_task" {
  value = {
    task_arn           = aws_lambda_function.fake_processing_task.arn
    last_modified_date = aws_lambda_function.fake_processing_task.last_modified
  }
}

output "files_to_granules_task" {
  value = {
    task_arn           = aws_lambda_function.files_to_granules_task.arn
    last_modified_date = aws_lambda_function.files_to_granules_task.last_modified
  }
}

output "hello_world_task" {
  value = {
    task_arn           = aws_lambda_function.hello_world_task.arn
    last_modified_date = aws_lambda_function.hello_world_task.last_modified
  }
}

output "hyrax_metadata_updates_task" {
  value = {
    task_arn           = aws_lambda_function.hyrax_metadata_updates_task.arn
    task_log_group     = aws_cloudwatch_log_group.hyrax_metadata_updates_task.name
    last_modified_date = aws_lambda_function.hyrax_metadata_updates_task.last_modified
  }
}

output "kinesis_fallback_topic_arn" {
  value = aws_sns_topic.kinesis_fallback.arn
}

output "kinesis_inbound_event_logger_lambda_function_arn" {
  value = aws_lambda_function.kinesis_inbound_event_logger.arn
}

output "lzards_backup_task" {
  value = (length(aws_lambda_function.lzards_backup_task) > 0 ?
  ({
      task_arn = aws_lambda_function.lzards_backup_task[0].arn
      last_modified_date = aws_lambda_function.lzards_backup_task[0].last_modified
  }) :
  { task_arn = ""})
}

output "manual_consumer_lambda_function_arn" {
  value = aws_lambda_function.manual_consumer.arn
}

output "message_consumer_lambda_function_arn" {
  value = aws_lambda_function.message_consumer.arn
}

output "move_granules_task" {
  value = {
    task_arn           = aws_lambda_function.move_granules_task.arn
    last_modified_date = aws_lambda_function.move_granules_task.last_modified
  }
}

output "parse_pdr_task" {
  value = {
    task_arn           = aws_lambda_function.parse_pdr_task.arn
    task_log_group     = aws_cloudwatch_log_group.parse_pdr_task.name
    last_modified_date = aws_lambda_function.parse_pdr_task.last_modified
  }
}

output "pdr_status_check_task" {
  value = {
    task_arn           = aws_lambda_function.pdr_status_check_task.arn
    last_modified_date = aws_lambda_function.pdr_status_check_task.last_modified
  }
}

output "post_to_cmr_task" {
  value = {
    task_arn           = aws_lambda_function.post_to_cmr_task.arn
    task_log_group     = aws_cloudwatch_log_group.post_to_cmr_task.name
    last_modified_date = aws_lambda_function.post_to_cmr_task.last_modified
  }
}

output "orca_copy_to_archive_adapter_task" {
  value = {
    task_arn           = aws_lambda_function.orca_copy_to_archive_adapter_task.arn
    task_log_group     = aws_cloudwatch_log_group.orca_copy_to_archive_adapter_task.name
    last_modified_date = aws_lambda_function.orca_copy_to_archive_adapter_task.last_modified
  }
}

output "orca_recovery_adapter_task" {
  value = {
    task_arn           = aws_lambda_function.orca_recovery_adapter_task.arn
    task_log_group     = aws_cloudwatch_log_group.orca_recovery_adapter_task.name
    last_modified_date = aws_lambda_function.orca_recovery_adapter_task.last_modified
  }
}

output "queue_granules_task" {
  value = {
    task_arn           = aws_lambda_function.queue_granules_task.arn
    last_modified_date = aws_lambda_function.queue_granules_task.last_modified
  }
}

output "queue_pdrs_task" {
  value = {
    task_arn           = aws_lambda_function.queue_pdrs_task.arn
    task_log_group     = aws_cloudwatch_log_group.queue_pdrs_task.name
    last_modified_date = aws_lambda_function.queue_pdrs_task.last_modified
  }
}

output "queue_workflow_task" {
  value = {
    task_arn           = aws_lambda_function.queue_workflow_task.arn
    task_log_group     = aws_cloudwatch_log_group.queue_workflow_task.name
    last_modified_date = aws_lambda_function.queue_workflow_task.last_modified
  }
}

output "schedule_sf_lambda_function_arn" {
  value = aws_lambda_function.schedule_sf.arn
}

output "send_pan_task" {
  value = {
    task_arn           = aws_lambda_function.send_pan_task.arn
    last_modified_date = aws_lambda_function.send_pan_task.last_modified
  }
}

output "sf_sqs_report_task" {
  value = {
    task_arn           = aws_lambda_function.sf_sqs_report_task.arn
    last_modified_date = aws_lambda_function.sf_sqs_report_task.last_modified
  }
}

output "sf_semaphore_down_lambda_function_arn" {
  value = aws_lambda_function.sf_semaphore_down.arn
}

output "sqs_message_remover_lambda_function_arn" {
  value = module.sqs_message_remover_lambda.function_arn
}

output "sqs2sfThrottle_lambda_function_arn" {
  value = aws_lambda_function.sqs2sfThrottle.arn
}

output "sync_granule_task" {
  value = {
    task_arn           = aws_lambda_function.sync_granule_task.arn
    task_log_group     = aws_cloudwatch_log_group.sync_granule_task.name
    last_modified_date = aws_lambda_function.sync_granule_task.last_modified
  }
}

output "update_cmr_access_constraints_task" {
  value = {
    task_arn           = aws_lambda_function.update_cmr_access_constraints_task.arn
    task_log_group     = aws_cloudwatch_log_group.update_cmr_access_constraints_task.name
    last_modified_date = aws_lambda_function.update_cmr_access_constraints_task.last_modified
  }
}

output "step_role_arn" {
  value = aws_iam_role.step.arn
}

output "scaling_role_arn" {
  value = aws_iam_role.scaling.arn
}

output "background_queue_url" {
  value = aws_sqs_queue.background_processing.id
}

output "start_sf_queue_url" {
  value = aws_sqs_queue.start_sf.id
}

output "update_granules_cmr_metadata_file_links_task" {
  value = {
    task_arn           = aws_lambda_function.update_granules_cmr_metadata_file_links_task.arn
    last_modified_date = aws_lambda_function.update_granules_cmr_metadata_file_links_task.last_modified
  }
}

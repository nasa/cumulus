output "dynamo_tables" {
  value = {
    access_tokens = {
      name = aws_dynamodb_table.access_tokens_table.name,
      arn  = aws_dynamodb_table.access_tokens_table.arn
    }
    async_operations = {
      name = aws_dynamodb_table.async_operations_table.name
      arn  = aws_dynamodb_table.async_operations_table.arn
    }
    collections = {
      name = aws_dynamodb_table.collections_table.name
      arn  = aws_dynamodb_table.collections_table.arn
    }
    executions = {
      name = aws_dynamodb_table.executions_table.name
      arn  = aws_dynamodb_table.executions_table.arn
    }
    files = {
      name = aws_dynamodb_table.files_table.name
      arn  = aws_dynamodb_table.files_table.arn
    }
    granules = {
      name = aws_dynamodb_table.granules_table.name
      arn  = aws_dynamodb_table.granules_table.arn
    }
    pdrs = {
      name = aws_dynamodb_table.pdrs_table.name
      arn  = aws_dynamodb_table.pdrs_table.arn
    }
    providers = {
      name = aws_dynamodb_table.providers_table.name
      arn  = aws_dynamodb_table.providers_table.arn
    }
    rules = {
      name = aws_dynamodb_table.rules_table.name
      arn  = aws_dynamodb_table.rules_table.arn
    }
    semaphores = {
      name = aws_dynamodb_table.semaphores_table.name
      arn  = aws_dynamodb_table.semaphores_table.arn
    }
    users = {
      name = aws_dynamodb_table.users_table.name
      arn  = aws_dynamodb_table.users_table.arn
    }
  }
}

output "elasticsearch_domain_arn" {
  value = local.deploy_inside_vpc ? aws_elasticsearch_domain.es_vpc[0].arn : (local.deploy_outside_vpc ? aws_elasticsearch_domain.es[0].arn : null)
}

output "elasticsearch_hostname" {
  value = local.deploy_inside_vpc ? aws_elasticsearch_domain.es_vpc[0].endpoint : (local.deploy_outside_vpc ? aws_elasticsearch_domain.es[0].endpoint : null)
}

output "elasticsearch_security_group_id" {
  value = local.deploy_inside_vpc ? aws_security_group.es_vpc[0].id : null
}

output "elasticsearch_alarms" {
  value = [
    {
      name = aws_cloudwatch_metric_alarm.es_nodes_low.alarm_name
      arn  = aws_cloudwatch_metric_alarm.es_nodes_low.arn
    },
    {
      name = aws_cloudwatch_metric_alarm.es_nodes_high.alarm_name
      arn  = aws_cloudwatch_metric_alarm.es_nodes_high.arn
    }
  ]
}

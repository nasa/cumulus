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
    reconciliation_reports = {
      name = aws_dynamodb_table.reconciliation_reports_table.name
      arn  = aws_dynamodb_table.reconciliation_reports_table.arn
    }
    rules = {
      name = aws_dynamodb_table.rules_table.name
      arn  = aws_dynamodb_table.rules_table.arn
    }
    semaphores = {
      name = aws_dynamodb_table.semaphores_table.name
      arn  = aws_dynamodb_table.semaphores_table.arn
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
  value = (var.include_elasticsearch ?
    [
      {
        name = aws_cloudwatch_metric_alarm.es_nodes_low[0].alarm_name
        arn  = aws_cloudwatch_metric_alarm.es_nodes_low[0].arn
      },
      {
        name = aws_cloudwatch_metric_alarm.es_nodes_high[0].alarm_name
        arn  = aws_cloudwatch_metric_alarm.es_nodes_high[0].arn
      }
    ]
    :
    []
  )
}

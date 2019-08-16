output "dynamo_tables" {
  value = {
    AccessTokens    = aws_dynamodb_table.access_tokens_table.name
    AsyncOperations = aws_dynamodb_table.async_operations_table.name
    Collections     = aws_dynamodb_table.collections_table.name
    Executions      = aws_dynamodb_table.executions_table.name
    Files           = aws_dynamodb_table.files_table.name
    Granules        = aws_dynamodb_table.granules_table.name
    Pdrs            = aws_dynamodb_table.pdrs_table.name
    Providers       = aws_dynamodb_table.providers_table.name
    Rules           = aws_dynamodb_table.rules_table.name
    Semaphores      = aws_dynamodb_table.semaphores_table.name
    Users           = aws_dynamodb_table.users_table.name
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

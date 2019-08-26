resource "aws_lambda_function" "custom_bootstrap" {
  function_name    = "${var.prefix}-CustomBootstrap"
  filename         = "${path.module}/../../packages/api/dist/bootstrap/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/bootstrap/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 320
  environment {
    variables = {
      CMR_ENVIRONMENT = var.cmr_environment
      stackName       = var.prefix
      system_bucket   = var.system_bucket
    }
  }
  tags = merge(local.default_tags, { Project = var.prefix })
  vpc_config {
    subnet_ids = var.lambda_subnet_ids
    security_group_ids = [
      aws_security_group.no_ingress_all_egress.id,
      var.elasticsearch_security_group_id
    ]
  }
}

data "aws_lambda_invocation" "custom_bootstrap" {
  function_name = aws_lambda_function.custom_bootstrap.function_name

  input = <<JSON
{
  "ResourceProperties": {
    "ElasticSearch": {
      "host": "${var.elasticsearch_hostname}"
    },
    "Cmr": {
      "Password": "${var.cmr_password}"
    },
    "Users": {
      "table": "${var.dynamo_tables.users.name}",
      "records": ${jsonencode([for x in var.users : { username : x, password : "OAuth" }])}
    },
    "DynamoDBTables": []
  }
}
JSON
}

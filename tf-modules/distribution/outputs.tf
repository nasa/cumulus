output "s3_credentials_redirect_uri" {
  value = var.deploy_s3_credentials_endpoint ? "${var.tea_internal_api_endpoint}redirect" : null
}

output "distribution_bucket_map" {
  value = jsondecode(data.aws_lambda_invocation.tea_map_cache.result)
}

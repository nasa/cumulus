output "api_uri" {
  value = local.api_uri
}

output "api_redirect_uri" {
  value = local.api_redirect_uri
}

output "distribution_bucket_map" {
  value = jsondecode(data.aws_lambda_invocation.bucket_map_cache.result)
}

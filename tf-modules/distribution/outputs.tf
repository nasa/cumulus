output "distribution_bucket_map" {
  value = jsondecode(data.aws_lambda_invocation.tea_map_cache.result)
}

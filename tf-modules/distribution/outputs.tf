output "distribution_url" {
  value = module.thin_egress_app.api_endpoint
}

output "internal_tea_api" {
  value = module.thin_egress_app.internal_api_endpoint
}

output "rest_api_id" {
  value = module.thin_egress_app.rest_api.id
}

output "s3_credentials_redirect_uri" {
  value = "${module.thin_egress_app.api_endpoint}redirect"
}

output "thin_egress_app_redirect_uri" {
  value = module.thin_egress_app.urs_redirect_uri
}

output "distribution_bucket_map" {
  value = jsondecode(data.aws_lambda_invocation.tea_map_cache.result)
}

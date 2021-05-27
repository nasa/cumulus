output "api_uri" {
  value = local.api_uri
}

output "api_redirect_uri" {
  value = local.api_redirect_uri
}

output "s3_credentials_cumulus_redirect_uri" {
  value = var.deploy_s3_credentials_endpoint ? "${local.api_uri}redirect" : null
}

output "archive_api_uri" {
  value = module.archive.api_uri
}

output "archive_api_redirect_uri" {
  value = module.archive.api_redirect_uri
}

output "distribution_url" {
  value = module.distribution.distribution_url
}

output "s3_credentials_redirect_uri" {
  value = module.distribution.s3_credentials_redirect_uri
}

output "distribution_redirect_uri" {
  value = module.distribution.thin_egress_app_redirect_uri
}

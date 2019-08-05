output "distribution_url" {
  value = module.distribution.distribution_url
}

output "thin_egress_app_redirect_uri" {
  value = module.distribution.thin_egress_app_redirect_uri
}

output "s3_credentials_redirect_uri" {
  value = module.distribution.s3_credentials_redirect_uri
}

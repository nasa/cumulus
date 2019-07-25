output "distribution_url" {
  value = module.cumulus.distribution_url
}

output "thin_egress_app_redirect_uri" {
  value = module.cumulus.thin_egress_app_redirect_uri
}

output "s3_credentials_redirect_uri" {
  value = module.cumulus.s3_credentials_redirect_uri
}

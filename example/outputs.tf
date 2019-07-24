output "thin_egress_app_domain_name" {
  value = module.cumulus.thin_egress_app_domain_name
}

output "thin_egress_app_redirect_uri" {
  value = module.cumulus.thin_egress_app_redirect_uri
}

output "s3_credentials_redirect_uri" {
  value = module.cumulus.s3_credentials_redirect_uri
}

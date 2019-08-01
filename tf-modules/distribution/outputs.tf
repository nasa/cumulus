output "distribution_url" {
  value = module.thin_egress_app.api_endpoint
}

output "thin_egress_app_redirect_uri" {
  value = module.thin_egress_app.urs_redirect_uri
}

output "s3_credentials_redirect_uri" {
  value = "${module.thin_egress_app.api_endpoint}redirect"
}

output "egress_log_group" {
  value = module.thin_egress_app.egress_log_group
}

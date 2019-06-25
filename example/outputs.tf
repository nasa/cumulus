output "tea_api_endpoint" {
  value = module.thin_egress_app.api_endpoint
}

output "tea_urs_redirect_uri" {
  value = module.thin_egress_app.urs_redirect_uri
}

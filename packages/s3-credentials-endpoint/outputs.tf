output "redirect_uri" {
  value = "${var.distribution_url}${aws_api_gateway_resource.s3_credentials_redirect.path_part}"
}

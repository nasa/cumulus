output "iceberg_api_uri" {
  description = "URI for the Iceberg API"
  value       = "https://${aws_lb.iceberg_api.dns_name}/"
}

output "iceberg_admin_list_param" {
  description = "The Iceberg admins list SSM parameter"
  value       = aws_ssm_parameter.iceberg_admin_list_param
}

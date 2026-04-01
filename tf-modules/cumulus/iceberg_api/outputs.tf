output "iceberg_api_uri" {
  description = "URI for the Iceberg API"
  value       = "https://${aws_lb.iceberg_api.dns_name}/"
}

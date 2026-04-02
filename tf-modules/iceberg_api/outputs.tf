output "iceberg_api_lb_dns_name" {
  description = "DNS name of the Iceberg API load balancer"
  value       = aws_lb.iceberg_api.dns_name
}

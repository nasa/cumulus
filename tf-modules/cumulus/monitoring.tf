module "monitoring" {
  source = "../monitoring"

  prefix               = var.prefix
  elasticsearch_alarms = var.elasticsearch_alarms
  ecs_service_alarms   = var.ecs_service_alarms
}

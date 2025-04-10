module "monitoring" {
  source = "../monitoring"

  prefix               = var.prefix
  ecs_service_alarms   = var.ecs_service_alarms
  system_bucket        = var.system_bucket
}

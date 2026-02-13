locals {
  environment = var.prefix
  tags = merge(var.default_tags, {
      team: "Cumulus Coreification Engineering",
      application: var.app_name
  })
}

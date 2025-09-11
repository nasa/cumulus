prefix                 = "demo1"
db_admin_username      = "postgres"
db_admin_password      = "sk82niT!"
region                 = "us-east-1"
vpc_id                 = "vpc-0963b6aeebee016ad"
subnets                = ["subnet-006462bcf62042ed2", "subnet-05f97d83f6d3e47fc"]
deletion_protection    = false
cluster_identifier     = "demo1-cumulus-3669-rds"
tags                   = { "Deployment" = "demo1-cumulus-3669" }
# enable_upgrade = true
snapshot_identifier    = "demo1-cumulus-3669-rds-final-snapshot"
cluster_instance_count = 1
prefix                 = "teclark021125"
db_admin_username      = "postgres"
db_admin_password      = "sk82niT!"
region                 = "us-east-1"
vpc_id                 = "vpc-0963b6aeebee016ad"
subnets                = ["subnet-006462bcf62042ed2", "subnet-05f97d83f6d3e47fc"]
deletion_protection    = true
cluster_identifier     = "teclark021125-cumulus-rds-v2"
cluster_instance_count = 1
tags                   = { "Deployment" = "teclark021125-cumulus-rds-v2" }
prefix                 = "cumulus-dev"
db_admin_username      = "postgres"
db_admin_password      = "wE56sKtaEDSqVl4HB2dZuc11in"
region                 = "us-east-1"
vpc_id                 = "vpc-0963b6aeebee016ad"
subnets                = ["subnet-006462bcf62042ed2", "subnet-05f97d83f6d3e47fc"]
deletion_protection    = true
cluster_identifier     = "cumulus-dev-rds-cluster-v2"
cluster_instance_count = 3
tags                   = { "Deployment" = "cumulus-dev-rds-cluster-v2" }
snapshot_identifier    = "arn:aws:rds:us-east-1:596205514787:cluster-snapshot:rds:cumulus-dev-rds-cluster-2024-04-19-07-10"
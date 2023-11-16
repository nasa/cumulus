terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
provider "aws" {
  region  = var.region
  profile = var.profile
  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}
resource "aws_db_subnet_group" "default" {
  name_prefix = var.aws_db_subnet_group_prefix
  subnet_ids  = var.subnets
  tags        = var.tags
}

resource "aws_security_group" "rds_cluster_access" {
  name_prefix = var.security_group_name
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_secretsmanager_secret" "rds_login" {
  name_prefix = "cumulus_rds_db_cluster"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "rds_login" {
  secret_id = aws_secretsmanager_secret.rds_login.id
  secret_string = jsonencode({
    username            = var.db_admin_username
    password            = var.db_admin_password
    database            = "postgres"
    engine              = "postgres"
    host                = var.manage_engine_version ? aws_rds_cluster.cumulus_managed_engine_version[*].endpoint : aws_rds_cluster.cumulus[*].endpoint
    port                = 5432
    dbClusterIdentifier = var.manage_engine_version ? aws_rds_cluster.cumulus_managed_engine_version[*].id : aws_rds_cluster.cumulus[*].id
  })
}

resource "aws_security_group_rule" "rds_security_group_allow_postgres" {
  type              = "ingress"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  security_group_id = aws_security_group.rds_cluster_access.id
  self              = true
}

resource "aws_rds_cluster_parameter_group" "rds_cluster_group" {
  name_prefix   = "${var.prefix}-cluster-parameter-group"
  family = var.parameter_group_family

  dynamic "parameter" {
    for_each = var.db_parameters
    content {
      apply_method = parameter.value["apply_method"]
      name = parameter.value["name"]
      value = parameter.value["value"]
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_rds_cluster" "cumulus_managed_engine_version" {
  count = var.manage_engine_version ? 1 : 0
  depends_on              = [aws_db_subnet_group.default, aws_rds_cluster_parameter_group.rds_cluster_group]
  cluster_identifier      = var.cluster_identifier
  engine_mode             = "serverless"
  engine                  = "aurora-postgresql"
  engine_version          = var.engine_version
  database_name           = "postgres"
  master_username         = var.db_admin_username
  master_password         = var.db_admin_password
  backup_retention_period = var.backup_retention_period
  preferred_backup_window = var.backup_window
  db_subnet_group_name    = aws_db_subnet_group.default.id
  apply_immediately       = var.apply_immediately
  scaling_configuration {
    max_capacity = var.max_capacity
    min_capacity = var.min_capacity
    timeout_action = var.rds_scaling_timeout_action
  }
  vpc_security_group_ids          = [aws_security_group.rds_cluster_access.id]
  deletion_protection             = var.deletion_protection
  enable_http_endpoint            = true
  tags                            = var.tags
  final_snapshot_identifier       = "${var.cluster_identifier}-final-snapshot"
  snapshot_identifier             = var.snapshot_identifier
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.rds_cluster_group.id
  allow_major_version_upgrade     = var.allow_major_version_upgrade

  lifecycle {
    ignore_changes = []
  }
}

resource "aws_rds_cluster" "cumulus" {
  count = !var.manage_engine_version ? 1 : 0
  depends_on              = [aws_db_subnet_group.default, aws_rds_cluster_parameter_group.rds_cluster_group]
  cluster_identifier      = var.cluster_identifier
  engine_mode             = "serverless"
  engine                  = "aurora-postgresql"
  engine_version          = var.engine_version
  database_name           = "postgres"
  master_username         = var.db_admin_username
  master_password         = var.db_admin_password
  backup_retention_period = var.backup_retention_period
  preferred_backup_window = var.backup_window
  db_subnet_group_name    = aws_db_subnet_group.default.id
  apply_immediately       = var.apply_immediately
  scaling_configuration {
    max_capacity = var.max_capacity
    min_capacity = var.min_capacity
    timeout_action = var.rds_scaling_timeout_action
  }
  vpc_security_group_ids          = [aws_security_group.rds_cluster_access.id]
  deletion_protection             = var.deletion_protection
  enable_http_endpoint            = true
  tags                            = var.tags
  final_snapshot_identifier       = "${var.cluster_identifier}-final-snapshot"
  snapshot_identifier             = var.snapshot_identifier
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.rds_cluster_group.id
  allow_major_version_upgrade     = var.allow_major_version_upgrade

  lifecycle {
    ignore_changes = [engine_version]
  }
}

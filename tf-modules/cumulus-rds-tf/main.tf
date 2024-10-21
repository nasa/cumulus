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
    host                = aws_rds_cluster.cumulus.endpoint
    hostReader          = aws_rds_cluster.cumulus.reader_endpoint
    port                = 5432
    dbClusterIdentifier = aws_rds_cluster.cumulus.id
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

resource "aws_rds_cluster_parameter_group" "rds_cluster_group_v13" {
  name   = "${var.prefix}-cluster-parameter-group-v13"
  family = var.parameter_group_family_v13

  dynamic "parameter" {
    for_each = var.db_parameters
    content {
      apply_method = parameter.value["apply_method"]
      name = parameter.value["name"]
      value = parameter.value["value"]
    }
  }
}

resource "aws_rds_cluster" "cumulus" {
  depends_on              = [aws_db_subnet_group.default, aws_rds_cluster_parameter_group.rds_cluster_group_v13]
  cluster_identifier      = var.cluster_identifier
  engine_mode             = "provisioned"
  engine                  = "aurora-postgresql"
  engine_version          = var.engine_version
  database_name           = "postgres"
  master_username         = var.db_admin_username
  master_password         = var.db_admin_password
  backup_retention_period = var.backup_retention_period
  preferred_backup_window = var.backup_window
  db_subnet_group_name    = aws_db_subnet_group.default.id
  apply_immediately       = var.apply_immediately
  storage_encrypted       = true
  
  serverlessv2_scaling_configuration {
    max_capacity = var.max_capacity
    min_capacity = var.min_capacity
  }
  vpc_security_group_ids          = [aws_security_group.rds_cluster_access.id]
  deletion_protection             = var.deletion_protection
  enable_http_endpoint            = true
  tags                            = var.tags
  final_snapshot_identifier       = "${var.cluster_identifier}-final-snapshot"
  snapshot_identifier             = var.snapshot_identifier
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.rds_cluster_group_v13.id

  lifecycle {
    ignore_changes = [engine_version]
  }
}

resource "aws_rds_cluster_instance" "cumulus" {
  cluster_identifier = aws_rds_cluster.cumulus.id
  identifier = "${aws_rds_cluster.cumulus.id}-instance-${count.index+1}"
  count              = var.cluster_instance_count
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.cumulus.engine
  engine_version     = aws_rds_cluster.cumulus.engine_version
}
# SCRIPT FOR IMPORTING CLOUDWATCH LOG GROUPS TO TERRAFORM STATE (DATA PERSISTENVCE)
terraform import module.data_persistence.module.db_migration.aws_cloudwatch_log_group.db_migration "/aws/lambda/${prefix}-postgres-db-migration"
terraform import module.provision_database.aws_cloudwatch_log_group.provision_database "/aws/lambda/${prefix}-ProvisionPostgresDatabase"

# SCRIPT FOR IMPORTING CLOUDWATCH LOG GROUPS TO TERRAFORM STATE (DATA PERSISTENCE TF)
#!/bin/zsh
set -e

echo -n "Enter the prefix used for your terraform deployment and press [ENTER]:"
read prefix
terraform init

terraform import module.data_persistence.module.db_migration.aws_cloudwatch_log_group.db_migration "/aws/lambda/$prefix-postgres-db-migration"
terraform import module.provision_database.aws_cloudwatch_log_group.provision_database "/aws/lambda/$prefix-ProvisionPostgresDatabase"

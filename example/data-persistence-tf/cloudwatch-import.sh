# SCRIPT FOR IMPORTING CLOUDWATCH LOG GROUPS TO TERRAFORM STATE (DATA PERSISTENCE TF), The module names may be different depending on the user
# check 'terraform state list' or 'terraform plan' in order to find out the module name for the respective log group and fix the script as needed.
# Additionally, all of the groups below may not apply to your deployment, please comment out log groups that are not causing 'ResourceAlreadyExistsException' or are
# not applicable to you.
#!/bin/zsh
set -e

echo "Importing Cloudwatch log groups for data-persistence-tf, please open the script and change or comment out any import commands respective to your deployment \n"
echo -n "Enter the prefix used for your terraform deployment and press [ENTER]:"
read prefix

terraform init --reconfigure
terraform import module.data_persistence.module.db_migration.aws_cloudwatch_log_group.db_migration "/aws/lambda/$prefix-postgres-db-migration"
terraform import module.provision_database.aws_cloudwatch_log_group.provision_database "/aws/lambda/$prefix-ProvisionPostgresDatabase"

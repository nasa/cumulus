# cumulus-rds-tf

This module provides a configurable "off the shelf" serverless RDS postgres database deployment that will provision a RDS Serverless postgres compatible database and provide a AWS Secrets Manager secret as required by Cumulus Core.
## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

## Outputs

This module's outputs are listed in [ouputs.tf](./outputs.tf).   Notably:

**rds_endpoint** - The cluster's endpoint.  This is used in later configuration values for the `data-persistence` module.

**admin_db_login_secret_arn** - The database administration login secret.    Used to provision user databases/logins/configure the cluster via ecosystem modules or manual administration.

**user_credentials_secret_arn** - If `provision_user_database` is set to `true` and `prefix`, `permissions_boundary_arn` and `rds_user_password` are set appropriately, the module will provision a user/database on the cluster and provide the secret for access.

**security_group_id** - A security group created to allow access to the .database.  Lambdas/resources that require access to the database *must* be in the configured VPC/subnets and be configured as part of this security group.

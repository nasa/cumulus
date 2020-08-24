# db-provision-user-database

This module deploys a bootstrap lambda that, given an AWS Secrets Manager secret specifying a 'root' database access credentials object containing 'host', 'user', 'password' keys, will:

1) If configured database is not already created:
  a) Add a database user based on the prefix and set the configured password
  b) Add a database based on the passed in prefix and set the user to use that database
2) If the configured database exists:
  a) Update the user password to the configured value
3) Write a database configuration object containing (at least) 'host', 'user', 'password' and 'database'

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

## Outputs

**database_credentials_secret_arn** - ARN of the AWS secrets manager user credentials secret

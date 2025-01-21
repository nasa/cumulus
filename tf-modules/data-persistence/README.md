# Data Persistence

This module deploys data persistence resources, including DynamoDB tables, and an RDS database and tables.

## Included resources

- DynamoDB tables:
  - `AccessTokensTable`
  - `SemaphoresTable`
- RDS database within the PostgreSQL-compatible cluster
- RDS database tables:
  - `async_operations`
  - `collections`
  - `executions`
  - `files`
  - `granules`
  - `granules_executions`
  - `pdrs`
  - `providers`
  - `rules`

**Please note**: All created resource names will be prefixed with the value of your `prefix` variable plus a hyphen (e.g. `prefix-AccessTokensTable`).

## Configuration

Configuration variables are shown in [`terraform.tfvars.example`](./terraform.tfvars.example) and are explained below. See [variables.tf](./variables.tf) for default values.

- `prefix` - prefix to use for naming created resources
- `enable_point_in_time_tables` - Names of DynamoDB tables that should have point in time recovery enabled. Any of the table names [listed above](#included-resources) are valid (use the table name without the prefix).
- `subnet_ids` - Subnet IDs that should be used when deploying Elasticsearch inside of a VPC. **If no subnet IDs are provided, Elasticsearch will not be deployed inside of a VPC.**
- `tags` - tags to be assigned to all managed resources which support tags

## Example

```hcl
module "data_persistence" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus.zip//tf-modules/data-persistence"

  prefix                     = "my-prefix"
  subnet_ids                 = ["subnet-123", "subnet-456"]
}
```

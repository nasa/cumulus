# Data Persistence

This module deploys data persistence resources, including DynamoDB tables and an Elasticsearch instance (which is optional).

## Included resources

- DynamoDB tables:
  - `AccessTokensTable`
  - `AsyncOperationsTable`
  - `CollectionsTable`
  - `ExecutionsTable`
  - `FilesTable`
  - `GranulesTable`
  - `PdrsTable`
  - `ProvidersTable`
  - `RulesTable`
  - `SemaphoresTable`
  - `UsersTable`
- Elasticsearch domain (with optional VPC configuration)
- Cloudwatch alarm for Elasticsearch node count

**Please note**: All created resource names will be prefixed with the value of your `prefix` variable plus a hyphen (e.g. `prefix-AccessTokensTable`).

## Configuration

Configuration variables are shown in [`terraform.tfvars.example`](./terraform.tfvars.example) and are explained below. See [variables.tf](./variables.tf) for default values.

- `prefix` - prefix to use for naming created resources
- `custom_domain_name` - Custom domain name to use for Elasticsearch instance
- `es_trusted_role_arns` - IAM role ARNs that should be trusted for accessing Elasticsearch
- `include_elasticsearch` - Whether to include Elasticsearch in the deployment. `false` will exclude Elasticsearch from the deployment.
- `elasticsearch_config` - Configuration for the Elasticsearch instance
- `enable_point_in_time_tables` - Names of DynamoDB tables that should have point in time recovery enabled. Any of the table names [listed above](#included-resources) are valid (use the table name without the prefix).
- `subnet_ids` - Subnet IDs that should be used when deploying Elasticsearch inside of a VPC. **If no subnet IDs are provided, Elasticsearch will not be deployed inside of a VPC.**

## Example

```hcl
module "data_persistence" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus.zip//tf-modules/data-persistence"

  prefix                     = "my-prefix"
  subnet_ids                 = ["subnet-123", "subnet-456"]
}
```

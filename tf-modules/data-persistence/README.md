# Data Persistence

This module deploys data persistence resources, including DynamoDB tables and an Elasticsearch instance (which is optional).

## Deployment

1. Copy the .tfvars sample file: `cp terraform.tfvars.sample terraform.tfvars`
2. Populate the sample file with values that apply to your AWS environment (see configuration variables section below).
3. Deploy this module: `terraform apply`

NOTE: Terraform will ignore the `aws_profile` config variable if you have static credentials or environment variables set, see the [AWS Provider page](https://www.terraform.io/docs/providers/aws/index.html#authentication).

## Configuration

Configuration variables are shown in [`terraform.tfvars.sample`](./terraform.tfvars.sample), and are explained below.

name|required|default|description
---|---|---|---
prefix|yes||prefix to use for naming created resources
es_trusted_role_arns|no|`[]`|IAM role ARNs that should be trusted for accessing Elasticsearch
create_service_linked_role|no|`true`|Whether to create an IAM service linked role for Elasticsearch. A service linked role is required for deploying Elasticsearch in a VPC. **However, a service linked role can only be created once per account, so you should set this variable to `false` if you already have one deloyed.**
include_elasticsearch|no|`true`|Whether to include Elasticsearch in the deployment. `false` will exclude Elasticsearch from the deployment.
elasticsearch_config|no|see [variables.tf](./variables.tf)|Configuration for the Elasticsearch instance
enable_point_in_time_tables|no|see [variables.tf](./variables.tf)|Names of DynamoDB tables that should have point in time recovery enabled
security_groups|no|`[]`|Security group IDs that should be used when deploying Elasticsearch inside of a VPC
subnet_ids|no|`[]`|Subnet IDs that should be used when deploying Elasticsearch inside of a VPC. **If no subnet IDs are provided, Elasticsearch will not be deployed inside of a VPC.**

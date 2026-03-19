# rds-iceberg-replication

This module provides a deployment for an ECS Fargate cluster with a single task that contains containers needed for RDS to Iceberg replication.

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

## Outputs

This module's output is listed in [ouputs.tf](./outputs.tf). Specifically:

**iceberg_replication_cluster_arn** - The Fargate cluster's arn. Useful for accessing the cluster via the CLI.





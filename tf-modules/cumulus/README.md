# Cumulus

This module provides an "off the shelf" version of a full Cumulus deployment featuring all supported functionality.

## Included resources

- [Archive module](../archive/main.tf) - Resources related to tracking the ingested data from Cumulus workflows
- [Ingest module](../ingest/main.tf) - Resources related to scheduling and running Cumulus workflows
- [Distribution module](../distribution/main.tf) - Provides the Distribution API for accessing ingested data
- [ECS cluster with configurable autoscaling](./ecs_cluster.tf)
- [Monitoring module](../monitoring) - Cloudwatch dashboard and other resources for monitoring your Cumulus deployment

## Input variables

### Required

- **cmr_client_id** (string) - Client ID that you want to use for requests to [CMR](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)
- **cmr_environment** (string) - Environment that should be used for CMR requests (e.g. "UAT", "SIT"
- **cmr_password** (string) - Password to use (in combination with `cmr_username`) for authorizing CMR requests
- **cmr_provider** (string) - The provider name should be used when storing metadata in CMR
- **cmr_username** (string) - Username to use (in combinatino with `cmr_password`) for authorizing CMR requests
- **cumulus_message_adapter_lambda_layer_arn** (string) - ARN of the Lambda layer for the Cumulus Message Adapter. See the [deployment documentation](https://nasa.github.io/cumulus//docs/cumulus-docs-readme) for how to obtain this ARN.
- **dynamo_tables** map(object) - A map of objects with the `arn` and `name` of every DynamoDB table for your Cumulus deployment. This variable map should not be generated manually but should be taken from the [`dynamo_tables` output of the `data-persistence` module](../data-persistence/outputs.tf).
- **ecs_cluster_desired_size** (number) - The desired maximum number of instances for your ECS autoscaling group
- **ecs_cluster_instance_subnet_ids** list(string) - The Subnet IDs to use for your ECS cluster instances.
- **ecs_cluster_max_size** (number) - The maximum number of instances for your ECS cluster
- **ecs_cluster_min_size** (number) - The minimum number of instances for your ECS cluster
- **elasticsearch_domain_arn** (string) - The ARN of your Elasticsearch domain. Should come from the [outputs of the `data-persistence` module](../data-persistence/outputs.tf).
- **elasticsearch_hostname** (string) - The hostname of your Elasticsearch domain. Should come from the [outputs of the `data-persistence` module](../data-persistence/outputs.tf).
- **elasticsearch_security_group_id** (string) - The ID of the security group used with your Elasticsearch domain. Should come from the [outputs of the `data-persistence` module](../data-persistence/outputs.tf).
- **prefix** (string) - The unique prefix for your deployment's resources
- **sts_credentials_lambda_name** (string) - The name of the Lambda function for
  the S3 credentials endpoint to invoke, which will return AWS API keys.
  Defaults to "gsfc-ngap-sh-s3-sts-get-keys".
- **system_bucket** (string) - The name of the S3 bucket to be used for staging deployment files
- **token_secret** (string) - A string value used for signing and verifying [JSON Web Tokens (JWTs)](https://jwt.io/) issued by the API. For security purposes, it is **strongly recommended that this value be a 32-character string**.
- **urs_client_id** (string) - The client ID for your Earthdata login application
- **urs_client_password** (string) - The client password for your Earthdata login application

## Outputs

This module's outputs are listed in [ouputs.tf](./outputs.tf). Notable values that you may want to include as outputs for your Cumulus deployment include:

- `archive_api_uri` - The URL to the deployed API gateway for the Cumulus archive/operator API
- `archive_api_redirect_uri` - The redirect URL that will be used for Oauth authentication flows with the Cumulus archive/operator API. **If you are using Earthdata login, you should add this URL to the list of allowed redirects for your Earthdata app**.
- `distribution_url` - The URL to the deployed API gateway for the Cumulus distribution API
- `distribution_redirect_uri` - The redirect URL that will be used for Oauth authentication flows with the Cumulus distribution API. **If you are using Earthdata login, you should add this URL to the list of allowed redirects for your Earthdata app**.
- `s3_credentials_redirect_uri` - The redirect URL that will be used for direct S3 credentials requests to the Cumulus distribution API. **If you are using Earthdata login, you should add this URL to the list of allowed redirects for your Earthdata app**.
- `report_executions_sns_topic_arn` - The ARN of the SNS topic used for reporting the status of Cumulus workflow executions. You will need this ARN if you want to publish to this topic directly.
- `report_granules_sns_topic_arn` - The ARN of the SNS topic used for reporting the ingest status of granules for Cumulus workflows. You will need this ARN if you want to publish to this topic directly.
- `report_pdrs_sns_topic_arn` - The ARN of the SNS topic used for reporting the ingest status of PDRs for Cumulus workflows. You will need this ARN if you want to publish to this topic directly.

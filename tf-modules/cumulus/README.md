# Cumulus

This module provides an "off the shelf" version of a full Cumulus deployment featuring all supported functionality.

## Included resources

- [Archive module](../archive) - Resources related to tracking the ingested data from Cumulus workflows
- [Ingest module](../ingest) - Resources related to scheduling and running Cumulus workflows
- [Distribution module](../distribution/README.md) - Provides the Distribution API for accessing ingested data
- [ECS cluster with configurable autoscaling](./ecs_cluster.tf)
- [Monitoring module](../monitoring) - Cloudwatch dashboard and other resources for monitoring your Cumulus deployment

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

## Outputs

This module's outputs are listed in [ouputs.tf](./outputs.tf). Notable values that you may want to include as outputs for your Cumulus deployment include:

- **archive_api_uri** - The URL to the deployed API gateway for the Cumulus archive/operator API
- **archive_api_redirect_uri** - The redirect URL that will be used for Oauth authentication flows with the Cumulus archive/operator API. **If you are using Earthdata login, you should add this URL to the list of allowed redirects for your Earthdata app**.
- **distribution_url** - The URL to the deployed API gateway for the Cumulus distribution API
- **distribution_redirect_uri** - The redirect URL that will be used for Oauth authentication flows with the Cumulus distribution API. **If you are using Earthdata login, you should add this URL to the list of allowed redirects for your Earthdata app**.
- **s3_credentials_redirect_uri** - The redirect URL that will be used for direct S3 credentials requests to the Cumulus distribution API. **If you are using Earthdata login, you should add this URL to the list of allowed redirects for your Earthdata app**.
- **report_executions_sns_topic_arn** - The ARN of the SNS topic used for reporting the status of Cumulus workflow executions. You will need this ARN if you want to publish to this topic directly.
- **report_granules_sns_topic_arn** - The ARN of the SNS topic used for reporting the ingest status of granules for Cumulus workflows. You will need this ARN if you want to publish to this topic directly.
- **report_pdrs_sns_topic_arn** - The ARN of the SNS topic used for reporting the ingest status of PDRs for Cumulus workflows. You will need this ARN if you want to publish to this topic directly.

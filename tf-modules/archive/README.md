# Cumulus Archive Terraform module

## Input variables

### Required

- **background_queue_name** (string)
- **cmr_client_id** (string) - Client ID that you want to use for requests to [CMR](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)
- **cmr_environment** (string) - Environment that should be used for CMR requests (e.g. "UAT", "SIT"
- **cmr_password** (string) - Password to use (in combination with `cmr_username`) for authorizing CMR requests
- **cmr_provider** (string) - The provider name should be used when storing metadata in CMR
- **cmr_username** (string) - Username to use (in combinatino with `cmr_password`) for authorizing CMR requests
- **distribution_api_id** (string)
- **distribution_url** (string)
- **dynamo_tables** map(object({ name = string, arn = string }))) - A map of objects with the `arn` and `name` of every DynamoDB table for your Cumulus deployment. This variable map should not be generated manually but should be taken from the [`dynamo_tables` output of the `data-persistence` module](../data-persistence/outputs.tf).
- **ecs_cluster_name**
- **elasticsearch_domain_arn** (string) - The ARN of your Elasticsearch domain. Should come from the [outputs of the `data-persistence` module](../data-persistence/outputs.tf).
- **elasticsearch_hostname** (string) - The hostname of your Elasticsearch domain. Should come from the [outputs of the `data-persistence` module](../data-persistence/outputs.tf).
- **elasticsearch_security_group_id** (string) - The ID of the security group used with your Elasticsearch domain. Should come from the [outputs of the `data-persistence` module](../data-persistence/outputs.tf).
- **ems_host** (string)
- **kinesis_inbound_event_logger_lambda_function_arn** (string)
- **lambda_processing_role_arn** (string)
- **message_consumer_function_arn** (string)
- **permissions_boundary_arn** (string)
- **prefix** (string) - The unique prefix for your deployment's resources
- **schedule_sf_function_arn** (string)
- **system_bucket** (string) - The name of the S3 bucket to be used for staging deployment files
- **token_secret** (string) - A string value used for signing and verifying [JSON Web Tokens (JWTs)](https://jwt.io/) issued by the API. For security purposes, it is **strongly recommended that this value be a 32-character string**.
- **urs_client_id** (string) - The client ID for your Earthdata login application
- **urs_client_password** (string) - The client password for your Earthdata login application

## Optional

- **api_gateway_stage** (string)
- **api_port** (number) - Port number that should be used for archive API requests
- **api_url** (string)
- **cmr_limit** (number) - Limit of the number of results to return from CMR
- **cmr_oauth_provider** (string) - Oauth provider to use for authorizing requests to CMR. Defaults to `earthdata`, which is used in conjunction with the `cmr_username` and `cmr_password` variables. `launchpad` is another option, which requires the `launchpad_certificate` and `launchpad_api` variables.
- **cmr_page_size** (number) - Default number of results to return per page when searching CMR for collections/granules.
- **daily_execution_payload_cleanup_schedule_expression** (string)
- **complete_execution_payload_timeout_disable** (string)
- **complete_execution_payload_timeout** (string)
- **non_complete_execution_payload_timeout_disable** (string)
- **non_complete_execution_payload_timeout** (string)
- **ems_datasource** (string)
- **ems_path** (string)
- **ems_port** (string)
- **ems_private_key** (string)
- **ems_provider** (string)
- **ems_retention_in_days** (number)
- **ems_submit_report** (bool)
- **ems_username** (string)
- **lambda_subnet_ids** list(string) - Subnet IDs for Lambdas
- **launchpad_api** (string) - URL of Launchpad API. Required if using `cmr_oauth_provider = "launchpad"`.
- **launchpad_certificate** (string) - Name of the Launchpad certificate uploaded to the `crypto` directory of the `system_bucket`. Defaults to `launchpad.pfx`.
- **oauth_provider** (string) - Oauth provider to use for authorizing requests to the archive API. Defaults to `earthdata`. Also accepts `launchpad`.
- **oauth_user_group** (string) - Oauth user group to validate the user against, if any. Applicable when using `oauth_provider = "launchpad"`.
- **private_archive_api_gateway** (bool) - Whether to deploy the archive API as a private API gateway. Defaults to `true`.
- **private_buckets** list(string)
- **protected_buckets** list(string)
- **public_buckets** list(string)
- **sts_credentials_lambda** (string)
- **urs_url** (string) - The URL of the Earthdata Login site. Defaults to `https://urs.earthdata.nasa.gov/`.
- **users** list(string)
- **vpc_id** (string) - VPC used by Lambda functions
- **region** (string) - The AWS region to deploy to, defaults to `us-east-1`.

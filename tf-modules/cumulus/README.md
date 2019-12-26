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

## Example

```hcl
module "cumulus" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus.zip//tf-modules/cumulus"

  cumulus_message_adapter_lambda_layer_arn = "arn:aws:lambda:us-east-1:1234567890:layer:Cumulus_Message_Adapter:1"

  prefix = "my-prefix"

  vpc_id            = "vpc-123"
  lambda_subnet_ids = ["subnet-123", "subnet-456"]

  ecs_cluster_instance_subnet_ids = ["subnet-123", "subnet-456"]
  ecs_cluster_min_size            = 1
  ecs_cluster_desired_size        = 1
  ecs_cluster_max_size            = 2
  key_name                        = "ecs-key-name"

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = "client-id-1"
  urs_client_password = "client-password"

  cmr_client_id   = "your-cmr-client"
  cmr_environment = "UAT"
  cmr_username    = "username"
  cmr_password    = "password"
  cmr_provider    = "your-daac-name"

  permissions_boundary_arn = "arn:aws:iam::1234567890:policy/SomePermissionsBoundary"

  system_bucket = "my-internal-bucket"
  buckets       = {
    internal = {
      name = "PREFIX-internal"
      type = "internal"
    }
    # ... more buckets ...
  }

  elasticsearch_alarms = ["arn:aws:cloudwatch:us-east-1:12345:alarm:prefix-es-NodesLowAlarm"]
  elasticsearch_domain_arn = "arn:aws:es:us-east-1:12345:domain/prefix-es"
  elasticsearch_hostname = "prefix-es-abcdef.us-east-1.es.amazonaws.com"
  elasticsearch_security_group_id = ["sg-12345"]

  dynamo_tables = {
    "access_tokens" = {
      "arn" = "arn:aws:dynamodb:us-east-1:12345:table/prefix-AccessTokensTable"
      "name" = "prefix-AccessTokensTable"
    }
    # ... more tables ...
  }

  token_secret = "a-random-32-character-string"

  archive_api_users = ["urs-user1", "urs-user2"]

  distribution_url = "https://abc123.execute-api.us-east-1.amazonaws.com/dev"

  sts_credentials_lambda_function_arn = "arn:aws:lambda:us-east-1:1234567890:function:sts-lambda"
}
```

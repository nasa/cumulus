# Cumulus

This module provides an "off the shelf" version of a full Cumulus deployment featuring all supported functionality.

## Included resources

- [Archive module](../archive/README.md) - Resources related to tracking the ingested data from Cumulus workflows
- [Ingest module](../ingest/README.md) - Resources related to scheduling and running Cumulus workflows
- [Distribution module](../distribution/README.md) - Provides the Distribution API for accessing ingested data
- [ECS cluster with configurable autoscaling](./ecs_cluster.tf)
- [Monitoring module](../monitoring) - Cloudwatch dashboard and other resources for monitoring your Cumulus deployment

## Input variables

### Required

- **cmr_client_id** (string)
- **cmr_environment** (string)
- **cmr_password** (string)
- **cmr_provider** (string)
- **cmr_username** (string)
- **cumulus_message_adapter_lambda_layer_arn** (string)
- **dynamo_tables** map(object({ name = string, arn = string })))
- **ecs_cluster_desired_size** (number) - The desired maximum number of instances for your ECS autoscaling group
- **ecs_cluster_instance_subnet_ids** list(string) - The Subnet IDs to use for your ECS cluster instances.
- **ecs_cluster_max_size** (number) - The maximum number of instances for your ECS cluster
- **ecs_cluster_min_size** (number) - The minimum number of instances for your ECS cluster
- **elasticsearch_domain_arn** (string)
- **elasticsearch_hostname** (string)
- **elasticsearch_security_group_id** (string)
- **prefix** (string)
- **sts_credentials_lambda_name** (string)
- **system_bucket** (string)
- **token_secret** (string)
- **urs_client_id** (string)
- **urs_client_password** (string)

### Optional

- **archive_api_port** (number) - Port number that should be used for archive API requests
- **archive_api_users** list(string) - List of Earthdata login usernames that should have access to the archive API
- **buckets** map(object) - Map of objects to specify the buckets for your deployment
- **cmr_limit** (number) - Limit of the number of results to return from CMR
- **cmr_oauth_provider** (string) - Oauth provider to use for authorizing requests to CMR. Defaults to `earthdata`, which is used in conjunction with the `cmr_username` and `cmr_password` variables. `launchpad` is another option, which requires the `launchpad_certificate` and `launchpad_api` variables.
- **cmr_page_size** (number) - Default number of results to return per page when searching CMR for collections/granules.
- **distribution_url** (string) - URL for the distribution API
- **ecs_container_stop_timeout** (string) - Time duration to wait from when a task is stopped before its containers are forcefully killed if they do not exit normally on their own. Defaults to `2m`.
- **ecs_cluster_instance_docker_volume_size** (number) - Size (in GB) of the volume that Docker uses for image and metadata storage. Defaults to `50`.
- **ecs_cluster_instance_image_id** (string) - AMI ID of ECS instances. Defaults to `ami-03e7dd4efa9b91eda`.
- **ecs_cluster_instance_type** (string) - EC2 instance type for cluster instances. Defaults to `t2.medium`.
- **ecs_docker_hub_config** object({ username = string, password = string, email = string }) - Credentials for integrating ECS with containers hosted on Docker Hub
- **ecs_docker_storage_driver** (string) - Storage driver for ECS tasks. Defaults to `overlay2`.
- **ecs_efs_config** object({ mount_target_id = string, mount_point = string }) - Config for using EFS with ECS instances
- **ecs_service_alarms** list(object({ name = string, arn = string })) - List of Cloudwatch alarms monitoring ECS instances, if any.
- **elasticsearch_alarms** list(object({ name = string, arn = string })) - List of Cloudwatch alarms monitoring Elasticsearch domain, if any.
- **key_name** (string) - Name of EC2 key pair for accessing EC2 instances
- **lambda_subnet_ids** list(string) - Subnet IDs for Lambdas
- **launchpad_api** (string) - URL of Launchpad API. Required if using `cmr_oauth_provider = "launchpad"`.
- **launchpad_certificate** (string) - Name of the Launchpad certificate uploaded to the `crypto` directory of the `system_bucket`. Defaults to `launchpad.pfx`.
- **oauth_provider** (string) - Oauth provider to use for authorizing requests to the archive API. Defaults to `earthdata`. Also accepts `launchpad`.
- **oauth_user_group** (string) - Oauth user group to validate the user against, if any. Applicable when using `oauth_provider = "launchpad"`.
- **permissions_boundary_arn** (string) - ARN of an IAM permissions boundary to use when deploying. Applicable when deploying to a NASA NGAP environment.
- **private_archive_api_gateway** (bool) - Whether to deploy the archive API as a private API gateway. Defaults to `true`.
- **queue_execution_limits** (map(number)) - Map specifying maximum concurrent execution limits for the queue(s) identified by the keys. Default:

```hcl
  {
    backgroundProcessing = 5
  }
```

- **urs_url** (string) - The URL of the Earthdata Login site. Defaults to `https://urs.earthdata.nasa.gov/`.
- **vpc_id** (string) - VPC used by Lambda functions
- **region** (string) - The AWS region to deploy to, defaults to `us-east-1`.

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

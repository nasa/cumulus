# Required

variable "cmr_client_id" {
  type = string
}

variable "cmr_environment" {
  type = string
}

variable "cmr_password" {
  type = string
}

variable "cmr_provider" {
  type = string
}

variable "cmr_username" {
  type = string
}

variable "bucket_map_key" {
  type    = string
  default = null
}

variable "cumulus_message_adapter_lambda_layer_version_arn" {
  type        = string
  description = "Layer version ARN of the Lambda layer for the Cumulus Message Adapter"
}

variable "cmr_oauth_provider" {
  type    = string
  default = "launchpad"
}

variable "csdap_client_id" {
  type        = string
  description = "The csdap client id"
}

variable "csdap_client_password" {
  type        = string
  description = "The csdap client password"
}

variable "csdap_host_url" {
  type        = string
  description = "The csdap host url"
}

variable "launchpad_api" {
  type    = string
  default = "launchpadApi"
}

variable "launchpad_certificate" {
  type    = string
  default = "launchpad.pfx"
}

variable "launchpad_passphrase" {
  type    = string
  default = ""
}
variable "lzards_launchpad_certificate" {
  type    = string
  default = "launchpad.pfx"
}

variable "lzards_launchpad_passphrase" {
  type    = string
  default = ""
}

variable "lzards_api" {
  description = "LZARDS API endpoint"
  type        = string
  default     = "https://lzards.sit.earthdata.nasa.gov/api/backups"
}

variable "lzards_provider" {
  description = "LZARDS provider name"
  type        = string
  default     = "CUMULUS_INTEGRATION_TESTS"
}

variable "lzards_s3_link_timeout" {
  description = "LZARDS S3 access link timeout (seconds)"
  type        = string
  default     = ""
}

variable "oauth_provider" {
  type    = string
  default = "earthdata"
}

variable "oauth_user_group" {
  type    = string
  default = "N/A"
}

variable "data_persistence_remote_state_config" {
  type = object({ bucket = string, key = string, region = string })
}

variable "s3_replicator_config" {
  type        = object({ source_bucket = string, source_prefix = string, target_bucket = string, target_prefix = string })
  default     = null
  description = "Configuration for the s3-replicator module. Items with prefix of source_prefix in the source_bucket will be replicated to the target_bucket with target_prefix."
}

variable "prefix" {
  type = string
}

variable "saml_entity_id" {
  type    = string
  default = "N/A"
}

variable "saml_assertion_consumer_service" {
  type    = string
  default = "N/A"
}

variable "saml_idp_login" {
  type    = string
  default = "N/A"
}

variable "saml_launchpad_metadata_url" {
  type    = string
  default = "N/A"
}

variable "system_bucket" {
  type = string
}

variable "token_secret" {
  type = string
}

variable "urs_client_id" {
  type = string
}

variable "urs_client_password" {
  type = string
}

# Optional

variable "vpc_id" {
  type = string
  default = null
}

variable "api_gateway_stage" {
  type        = string
  default     = "dev"
  description = "The archive API Gateway stage to create"
}

variable "ftp_host_configuration_bucket" {
  type = string
  default = "cumulus-test-sandbox-internal"
  description = "Bucket containing ftp test host configuration"
}

variable "api_reserved_concurrency" {
  type = number
  default = 5
  description = "Archive API Lambda reserved concurrency"
}

variable "buckets" {
  type    = map(object({ name = string, type = string }))
  default = {}
}

variable "cmr_search_client_config" {
  description = "Configuration parameters for CMR search client for cumulus tasks"
  type        = map(string)
  default     = {}
}

variable "cumulus_distribution_url" {
  type        = string
  default     = null
  description = "The url of cumulus distribution API Gateway endpoint"
}

variable "default_s3_multipart_chunksize_mb" {
  description = "default S3 multipart upload chunk size in MB"
  type = number
  default = 256
}

variable "tea_distribution_url" {
  type    = string
  default = null
}

variable "ecs_cluster_instance_subnet_ids" {
  type = list(string)
  default = []
}

variable "ecs_include_docker_cleanup_cronjob" {
  type    = bool
  default = false
}

variable "key_name" {
  type    = string
  default = null
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "permissions_boundary_arn" {
  type    = string
  default = null
}

variable "aws_profile" {
  type    = string
  default = null
}

variable "lambda_subnet_ids" {
  type = list(string)
  default = []
}

variable "log_api_gateway_to_cloudwatch" {
  type        = bool
  default     = false
  description = "Enable logging of API Gateway activity to CloudWatch."
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "Remote kinesis/destination arn for delivering logs."
}

variable "archive_api_port" {
  type    = number
  default = null
}

variable "archive_api_url" {
  type        = string
  default     = null
  description = "If not specified, the value of the Backend (Archive) API Gateway endpoint is used"
}

variable "private_archive_api_gateway" {
  type    = bool
  default = true
}

variable "thin_egress_jwt_secret_name" {
  type        = string
  description = "Name of AWS secret where keys for the Thin Egress App JWT encode/decode are stored"
  default     = "cumulus_sandbox_jwt_tea_secret"
}

variable "metrics_es_host" {
  type    = string
  default = null
}

variable "metrics_es_password" {
  type    = string
  default = null
}

variable "metrics_es_username" {
  type    = string
  default = null
}

variable "additional_log_groups_to_elk" {
  type    = map(string)
  default = {}
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}

variable "pdr_node_name_provider_bucket" {
  type = string
  description = "The name of the common bucket used as an S3 provider for PDR NODE_NAME tests"
  default = "cumulus-sandbox-pdr-node-name-provider"
}

variable "rds_connection_timing_configuration" {
  description = "Cumulus rds connection timeout retry timing object -- these values map to knex.js's internal use of  https://github.com/vincit/tarn.js/ for connection acquisition"
  type = map(number)
  default = {
      acquireTimeoutMillis: 90000
      createRetryIntervalMillis: 30000,
      createTimeoutMillis: 20000,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
  }
}

variable "rds_admin_access_secret_arn" {
  description = "AWS Secrets Manager secret ARN containing a JSON string of DB credentials (containing at least host, password, port as keys)"
  type        = string
}

variable "async_operation_image_version" {
  description = "docker image version to use for Cumulus async operations tasks"
  type = string
  default = "53"
}

variable "cumulus_process_activity_version" {
    description = "docker image version to use for python processing service"
    type = string
    default = "4"
}

variable "ecs_task_image_version" {
  description = "docker image version to use for Cumulus hello world task"
    type = string
    default = "2.1.0"
}

variable "cumulus_test_ingest_image_version" {
    description = "docker image version to use for python test ingest processing service"
    type = string
    default = "17"
}
variable "ecs_custom_sg_ids" {
  description = "User defined security groups to add to the Core ECS cluster"
  type = list(string)
  default = []
}

## ORCA Variables Definitions

variable "orca_db_user_password" {
  description = "Password for RDS orca database user authentication"
  type = string
}

variable "orca_default_bucket" {
  type        = string
  description = "Default ORCA S3 Glacier bucket to use."
}

variable "orca_dlq_subscription_email" {
  type        = string
  description = "The email to notify users when messages are received in dead letter SQS queue due to orca restore failure."
  default = "test@email.com"
}

variable "orca_s3_access_key" {
  type        = string
  description = "Access key for communicating with Orca S3 buckets."
  default = ""
}

variable "orca_s3_secret_key" {
  type        = string
  description = "Secret key for communicating with Orca S3 buckets."
  default = ""
}

variable "lambda_timeouts" {
  description = "Configurable map of timeouts for lambdas"
  type = map(number)
  default = {
    cleanExecutions = 400           # archive
    DistributionApiEndpoints = 400  # cumulus_distribution
    s3-credentials-endpoint  = 400  # distribution
    HelloWorld = 400                # ingest
    s3-replicator = 400             # s3-replicator
    TeaCache = 400                  # tea-map-cache
  }
}

variable "lambda_memory_sizes" {
  description = "Configurable map of memory sizes for lambdas"
  type = map(number)
  default = {
    cleanExecutions = 512           # archive
    DistributionApiEndpoints = 512  # cumulus_distribution
    HelloWorld = 512                # ingest
    s3-credentials-endpoint  = 512  # distribution
    s3-replicator = 512             # s3-replicator
    TeaCache = 512                  # tea-map-cache
  }
}

variable "optional_dynamo_tables" {
  type = map(object({ name = string, arn = string }))
  default = {}
  description = "A map of objects with the `arn` and `name` of every additional DynamoDB table your Cumulus deployment can reference."
}

variable "cmr_custom_host" {
  description = "Custom protocol and host to use for CMR requests (e.g. http://cmr-host.com)"
  type        = string
  default     = null
}

variable "deploy_cumulus_distribution" {
  description = "If true, does not deploy the TEA distribution API"
  type        = bool
  default     = true
}

variable "vpc_tag_name" {
  description = "Tag name to use for looking up VPC"
  type = string
  default = "Application VPC"
}

variable "subnets_tag_name" {
  description = "Tag name to use for looking up VPC subnets"
  type = string
  default = "Private application us-east-1a *"
}

variable "cloudwatch_log_retention_periods" {
  type = map(number)
  description = "retention periods for the respective cloudwatch log group, these values will be used instead of default retention days"
  default = {
    thin-egress-app-EgressLambda = 7
    ApiEndpoints = 7
    AsyncOperationEcsLogs = 7
    DiscoverPdrs = 7
    DistributionApiEndpoints = 7
    EcsLogs = 7
    granuleFilesCacheUpdater = 7
    HyraxMetadataUpdates = 7
    ParsePdr = 7
    PostToCmr = 7
    PrivateApiLambda = 7
    publishExecutions = 7
    publishGranules = 7
    QueuePdrs = 7
    QueueWorkflow = 7
    replaySqsMessages = 7
    SyncGranule = 7
    UpdateCmrAccessConstraints = 7
  }
}

variable "default_log_retention_days" {
  type = number
  default = 14
  description = "default value that user chooses for their log retention periods"
}

variable "report_sns_topic_subscriber_arns" {
  type = list
  default = null
}

## Dead Letter Recovery Configuration

variable "dead_letter_recovery_cpu" {
  type = number
  default = 256
  description = "The amount of CPU units to reserve for the dead letter recovery Async Operation Fargate Task"
}
variable "dead_letter_recovery_memory" {
  type = number
  default = 1024
  description = "The amount of memory in MB to reserve for the dead letter recovery Async Operation Fargate Task"
}

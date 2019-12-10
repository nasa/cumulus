# Required

variable "cmr_client_id" {
  description = "Client ID that you want to use for requests to CMR (https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)"
  type = string
}

variable "cmr_environment" {
  description = "Environment that should be used for CMR requests (e.g. 'UAT', 'SIT')"
  type = string
}

variable "cmr_password" {
  description = "Password to use (in combination with `cmr_username`) for authorizing CMR requests"
  type = string
}

variable "cmr_provider" {
  description = "The provider name should be used when storing metadata in CMR"
  type = string
}

variable "cmr_username" {
  description = "Username to use (in combination with `cmr_password`) for authorizing CMR requests"
  type = string
}

variable "cumulus_message_adapter_lambda_layer_arn" {
  description = "Layer version ARN of the Lambda layer for the Cumulus Message Adapter"
  type    = string
  default = null
}

variable "dynamo_tables" {
  description = "A map of objects with the `arn` and `name` of every DynamoDB table for your Cumulus deployment."
  type = map(object({ name = string, arn = string }))
}

variable "ecs_cluster_desired_size" {
  description = "The desired maximum number of instances for your ECS autoscaling group"
  type = number
}

variable "ecs_cluster_instance_subnet_ids" {
  description = "The Subnet IDs to use for your ECS cluster instances"
  type = list(string)
}

variable "ecs_cluster_max_size" {
  description = "The maximum number of instances for your ECS cluster"
  type = number
}

variable "ecs_cluster_min_size" {
  description = "The minimum number of instances for your ECS cluster"
  type = number
}

variable "elasticsearch_domain_arn" {
  description = "The ARN of an Elasticsearch domain to use for storing data"
  type = string
}

variable "elasticsearch_hostname" {
  description = "The hostname of an Elasticsearch domain to use for storing data"
  type = string
}

variable "elasticsearch_security_group_id" {
  description = "The ID of the security group for the Elasticsearch domain specified by `elasticsearch_domain_arn`"
  type = string
}

variable "prefix" {
  description = "The unique prefix for your deployment resources"
  type = string
}

variable "sts_credentials_lambda_function_arn" {
  type    = string
  default = null
}

variable "system_bucket" {
  description = "The name of the S3 bucket to be used for staging deployment files"
  type = string
}

variable "token_secret" {
  description = "A string value used for signing and verifying JSON Web Tokens (JWTs) issued by the archive API. Should be a 32-character string for security"
  type = string
}

variable "urs_client_id" {
  type        = string
  description = "The client ID for your Earthdata login (URS) application"
}

variable "urs_client_password" {
  type        = string
  description = "The client password for your Earthdata login (URS) application"
}

# Optional

variable "api_gateway_stage" {
  type        = string
  default     = "dev"
  description = "The archive API Gateway stage to create"
}

variable "archive_api_port" {
  description = "Port number that should be used for archive API requests"
  type    = number
  default = null
}

variable "archive_api_users" {
  description = "Earthdata (URS) usernames that should be allowed to access the archive API"
  type    = list(string)
  default = []
}

variable "buckets" {
  description = "Map identifying the buckets for the deployment"
  type    = map(object({ name = string, type = string }))
  default = {}
}

variable "cmr_limit" {
  description = "Limit of the number of results to return from CMR"
  type    = number
  default = 100
}

variable "cmr_oauth_provider" {
  description = "Oauth provider to use for authorizing requests to CMR"
  type    = string
  default = "earthdata"
}

variable "cmr_page_size" {
  description = "Default number of results to return per page when searching CMR for collections/granules"
  type    = number
  default = 50
}

variable "custom_queues" {
  description = "Map of SQS queue identifiers to queue URLs"
  type    = list(object({ id = string, url = string }))
  default = []
}

variable "deploy_distribution_s3_credentials_endpoint" {
  description = "Whether or not to include the S3 credentials endpoint in the Thin Egress App"
  type = bool
  default = true
}

variable "distribution_api_gateway_stage" {
  description = "The distribution API Gateway stage to create"
  type    = string
  default = "DEV"
}

variable "distribution_url" {
  description = " URL for the distribution API"
  type    = string
  default = null
}

variable "ecs_container_stop_timeout" {
  description = "Time duration to wait from when a task is stopped before its containers are forcefully killed if they do not exit normally on their own"
  type    = string
  default = "2m"
}

variable "ecs_cluster_instance_docker_volume_size" {
  type        = number
  description = "Size (in GB) of the volume that Docker uses for image and metadata storage"
  default     = 50
}

variable "ecs_cluster_instance_image_id" {
  type        = string
  description = "AMI ID of ECS instances"
  default     = "ami-0fa9de75aa0a1f1b3"
}

variable "ecs_cluster_instance_type" {
  type        = "string"
  description = "EC2 instance type for cluster instances"
  default     = "t2.medium"
}

variable "ecs_cluster_scale_in_adjustment_percent" {
  type    = number
  default = -5
}

variable "ecs_cluster_scale_in_threshold_percent" {
  type    = number
  default = 25
}

variable "ecs_cluster_scale_out_adjustment_percent" {
  type    = number
  default = 10
}

variable "ecs_cluster_scale_out_threshold_percent" {
  type    = number
  default = 75
}

variable "ecs_docker_hub_config" {
  description = "Credentials for integrating ECS with containers hosted on Docker Hu"
  type    = object({ username = string, password = string, email = string })
  default = null
}

variable "ecs_docker_storage_driver" {
  description = "Storage driver for ECS tasks"
  type    = string
  default = "devicemapper"
}

variable "ecs_efs_config" {
  description = "Config for using EFS with ECS instances"
  type    = object({ mount_target_id = string, mount_point = string })
  default = null
}

variable "ecs_service_alarms" {
  description = "List of Cloudwatch alarms monitoring ECS instances"
  type = list(object({ name = string, arn = string }))
  default = []
}

variable "elasticsearch_alarms" {
  description = "List of Cloudwatch alarms monitoring Elasticsearch domain"
  type = list(object({ name = string, arn = string }))
  default = []
}

variable "ems_datasource" {
  type        = string
  description = "the data source of EMS reports"
  default     = "UAT"
}

variable "ems_host" {
  type        = string
  description = "EMS host"
  default     = "change-ems-host"
}

variable "ems_path" {
  type        = string
  description = "EMS host directory path for reports"
  default     = "/"
}

variable "ems_port" {
  type        = number
  description = "EMS host port"
  default     = 22
}

variable "ems_private_key" {
  type        = string
  description = "the private key file used for sending reports to EMS"
  default     = "ems-private.pem"
}

variable "ems_provider" {
  type        = string
  description = "the provider used for sending reports to EMS"
  default     = "CUMULUS"
}

variable "ems_retention_in_days" {
  type        = number
  description = "the retention in days for reports and s3 server access logs"
  default     = 30
}

variable "ems_submit_report" {
  type        = bool
  description = "toggle whether the reports will be sent to EMS"
  default     = false
}

variable "ems_username" {
  type        = string
  description = "the username used for sending reports to EMS"
  default     = "cumulus"
}

variable "key_name" {
  description = "Name of EC2 key pair for accessing EC2 instances"
  type    = string
  default = null
}

variable "lambda_subnet_ids" {
  description = "Subnet IDs for Lambdas"
  type    = list(string)
  default = null
}

variable "launchpad_api" {
  description = "URL of Launchpad API. Required if using `cmr_oauth_provider = 'launchpad'`."
  type    = string
  default = "launchpadApi"
}

variable "launchpad_certificate" {
  description = "Name of the Launchpad certificate uploaded to the 'crypto' directory of the `system_bucket`. Required if using `cmr_oauth_provider = 'launchpad'`"
  type    = string
  default = "launchpad.pfx"
}

variable "launchpad_passphrase" {
  description = "Passphrase of Launchpad certificate. Required if using `cmr_oauth_provider = 'launchpad'`."
  type    = string
  default = ""
}

variable "log_api_gateway_to_cloudwatch" {
  type        = bool
  default     = false
  description = "Boolean switch to enable/disable logging of API Gateway distribution traffic to CloudWatch."
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "shared AWS:Log:Destination value. Requires log_api_gateway_to_cloudwatch set to true."
}

variable "metrics_es_host" {
  type = string
  default = null
}

variable "metrics_es_password" {
  type = string
  default = null
}

variable "metrics_es_username" {
  type = string
  default = null
}

variable "oauth_provider" {
  description = "Oauth provider to use for authorizing requests to the archive API. Also accepts 'launchhpad'"
  type    = string
  default = "earthdata"
}

variable "oauth_user_group" {
  description = "Oauth user group to validate the user against when using `oauth_provider = 'launchpad'`."
  type    = string
  default = "N/A"
}

variable "permissions_boundary_arn" {
  description = "The ARN of an IAM permissions boundary to use when creating IAM policies"
  type    = string
  default = null
}

variable "private_archive_api_gateway" {
  description = "Whether to deploy the archive API as a private API gateway"
  type = bool
  default = true
}

variable "saml_entity_id" {
  description = "The endpoint EntityID from the Launchpad Integration Request"
  type    = string
  default = "N/A"
}

variable "saml_assertion_consumer_service" {
  description = "The URL Bindings Assertion Point from the Launchpad Integration Request"
  type    = string
  default = "N/A"
}

variable "saml_idp_login" {
  description = "The SAML Identity Provider's saml2sso endpoint"
  type    = string
  default = "N/A"
}

variable "saml_launchpad_metadata_path" {
  description = "The S3 url of the Identity Provider public metadata xml file"
  type    = string
  default = "N/A"
}

variable "throttled_queues" {
  description = "Array of configuration for custom queues with execution limits"
  type    = list(object({ id = string, url = string, execution_limit = number }))
  default = []
}

variable "urs_url" {
  description = "The URL of the Earthdata login (URS) site"
  type        = string
  default     = "https://uat.urs.earthdata.nasa.gov/"
}

variable "vpc_id" {
  description = "VPC used by Lambda functions"
  type    = string
  default = null
}

# archive module clean_executions lambda configuration

variable "daily_execution_payload_cleanup_schedule_expression" {
  type    = string
  default = "cron(0 4 * * ? *)"
  description = "Cloud Watch cron schedule for the execution payload cleanup lambda"
}

variable "complete_execution_payload_timeout_disable" {
  type    = bool
  default = false
  description = "Boolean flag that when set to true will disable 'complete' execution cleanup"
}

variable "complete_execution_payload_timeout" {
  type    = number
  default = 10
  description = "Number of days to retain 'complete' execution payload records in the database"
}

variable "non_complete_execution_payload_timeout_disable" {
  type    = bool
  default = false
  description = "Boolean flag that when set to true will disable 'complete' execution cleanup"

}

variable "non_complete_execution_payload_timeout" {
  description = "Number of days to retain 'non-complete' execution payload records in the database"
  type    = number
  default = 30
}

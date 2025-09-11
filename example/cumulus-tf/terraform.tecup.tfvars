region = "us-east-1"

# Replace 12345 with your actual AWS account ID
cumulus_message_adapter_lambda_layer_version_arn = "arn:aws:lambda:us-east-1:596205514787:layer:Cumulus_Message_Adapter:20"
permissions_boundary_arn = "arn:aws:iam::596205514787:policy/NGAPShNonProdRoleBoundary"

prefix                   = "tecup"

buckets = {
  dashboard = {
    name = "cumulus-dashboard-sandbox"
    type = "dashboard"
  },
  glacier = {
    name = "cumulus-test-sandbox-orca-glacier"
    type = "orca"
  },
  internal = {
    name = "cumulus-test-sandbox-internal"
    type = "internal"
  }
  private = {
    name = "cumulus-test-sandbox-private"
    type = "private"
  },
  protected = {
    name = "cumulus-test-sandbox-protected"
    type = "protected"
  },
  public = {
    name = "cumulus-test-sandbox-public"
    type = "public"
  }
}

lambda_subnet_ids = ["subnet-006462bcf62042ed2", "subnet-05f97d83f6d3e47fc"]
system_bucket     = "cumulus-test-sandbox-internal"
vpc_id            = "vpc-0963b6aeebee016ad"

pdr_node_name_provider_bucket = "cumulus-sandbox-pdr-node-name-provider"

cmr_client_id   = "cumulus-core-teclark"
cmr_environment = "UAT"
cmr_password    = "sk82niT!sk82niT!"
cmr_provider    = "CUMULUS"
cmr_username    = "timclark_pe"
cmr_oauth_provider = "earthdata"

# Earthdata application client ID/password for authentication
urs_client_id       = "-VB_i0Ft258L0xTmGc9jqA"
urs_client_password = "iJ2417$@hfgy"

token_secret = "AQjfk3W472GeuBa7MwxqyOKIOUzgfTpQ"

data_persistence_remote_state_config = {
  bucket = "cumulus-sandbox-tfstate"
  key    = "teclark/data-persistence/terraform.tfstate"
  region = "us-east-1"
}

# Make archive API run as a private API gateway and accessible on port 8000
archive_api_port = 8000
private_archive_api_gateway = true

rds_admin_access_secret_arn = "arn:aws:secretsmanager:us-east-1:596205514787:secret:cumulus_rds_db_cluster_login_secret-UaEa01"
# ORCA Configuration
orca_db_user_password = "O1rcapostgre$!"
orca_default_bucket   = "cumulus-test-sandbox-orca-glacier"

# CSDAP configuration for cumulus distribution
csdap_client_id       = "46ue22nfcs3uj7qd2r6roqlb0t"
csdap_client_password = "TestClient1234!"
## url for uat: https://auth.csdap.uat.earthdatacloud.nasa.gov
csdap_host_url = "https://auth.csdap.uat.earthdatacloud.nasa.gov"

deploy_cumulus_distribution = true

# Optional, uncomment if needed, these variables are for configuring the cloudwatch log group's retention periods
# default_log_retention_days = 30
# cloudwatch_log_retention_periods = {
#   <lambda function or task name> = 365
# }
#

# Optional. Uncomment if using Cumulus Distribution.
# toggle this after deployed to put the correct port in. (and hosts and config)
# cumulus_distribution_url = "cumulus distribution url"

# Optional. Uncomment if using TEA.
# toggle this after deployed to put the correct port in. (and hosts and config)
# tea_distribution_url = "TEA distribution URL"

launchpad_api = "https://api.launchpad.nasa.gov/icam/api/sm/v1/"
launchpad_certificate = "certificate"
launchpad_passphrase = "passphrase"

oauth_provider   = "earthdata"

# Optional, uncomment if needed. Oauth user group to validate the user against when using oauth_provider = "launchpad".
# oauth_user_group = "usergroup"

# Optional, uncomment if needed.  When using oauth_provider = "launchpad", and if you are configuring Cumulus to authenticate
# the dashboard via NASA's Launchpad SAML implementation.
# see Wiki: https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus+SAML+Launchpad+Integration
/*
saml_entity_id                  = "Configured SAML entity-id"
saml_assertion_consumer_service = "<Cumulus API endpoint>/saml/auth, e.g. https://example.com/saml/auth"
*/

# Optional, uncomment if needed. Sandbox Launchpad saml2sso: https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso
# Production Launchpad saml2sso: https://auth.launchpad.nasa.gov/affwebservices/public/saml2sso
# saml_idp_login                  = "nasa's saml2sso endpoint, e.g. https://example.gov/affwebservices/public/saml2sso"

# Optional, uncomment if needed. Sandbox Launchpad IDP metadata: https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml
# Production Launchpad IDP Metadata: https://auth.launchpad.nasa.gov/unauth/metadata/launchpad.idp.xml
# saml_launchpad_metadata_url     = "url of the identity provider public metadata xml file"

# Optional, uncomment if needed.
key_name      = "tecup"

# Optional, uncomment if needed.
/*
metrics_es_host = "xxxxxxxxxx.cloudfront.net"
metrics_es_username = "user"
metrics_es_password = "password"
*/

# Optional, uncomment if needed. Required to send logs to the Metrics ELK stack
/*
log_api_gateway_to_cloudwatch = false
log_destination_arn = "arn:aws:logs:us-east-1:1234567890:destination:LogsDestination"
additional_log_groups_to_elk = {
  "LogDescriptor" = "log_group_name"
}
*/

# Optional, configure if needed. Adds policies to SNS report topics to support
#   cloud metrics integration.
#
#  If a Principal is specified as just an AWS account ID rather than an ARN,
#    AWS silently converts it to the ARN for the root user,
#    causing future terraform plans to differ. To avoid this problem,
#    specify the full ARN.
# report_sns_topic_subscriber_arns = ["arn:aws:iam::12345678:user/FederatedUser"]
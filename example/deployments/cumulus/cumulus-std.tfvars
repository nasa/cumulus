prefix = "cumulus-std"

buckets = {
  internal = {
    name = "cumulus-sit-internal"
    type = "internal"
  },
  private = {
    name = "cumulus-sit-private"
    type = "private"
  },
  protected = {
    name = "cumulus-sit-protected"
    type = "protected"
  },
  public = {
    name = "cumulus-sit-public"
    type = "public"
  },
  protected-2 = {
    name = "cumulus-sit-protected-2"
    type = "protected"
  },
  glacier = {
    name = "cumulus-sit-orca-glacier"
    type = "orca"
  },
  dashboard = {
    name = "cumulus-sit-dashboard"
    type = "dashboard"
  }
}

key_name      = "lp"

oauth_provider   = "launchpad"

saml_entity_id                  = "https://dashboard.cumulus.sit.earthdata.nasa.gov"
saml_assertion_consumer_service = "https://api.cumulus.sit.earthdata.nasa.gov/saml/auth"
saml_idp_login                  = "https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso"
saml_launchpad_metadata_url     = "https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml"

deploy_cumulus_distribution = false

archive_api_url = "https://api.cumulus.sit.earthdata.nasa.gov/"
private_archive_api_gateway = true

# LOG CONFIGURATION (optional)
log_api_gateway_to_cloudwatch = true

tea_distribution_url = "https://data.cumulus.sit.earthdata.nasa.gov"

s3_replicator_config = {
  source_bucket = "cumulus-std-access-logs"
  source_prefix = "s3_access_logs"
  target_bucket = "esdis-metrics-inbound-sit-cumulus-std-distribution"
  target_prefix = "input/s3_access/cumulus-stdsit"
}

api_reserved_concurrency = 14

lambda_timeouts = {
  queue_granules_task_timeout: 900,
  discover_granules_task_timeout: 900
}

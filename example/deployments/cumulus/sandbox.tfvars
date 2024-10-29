buckets = {
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
  protected-2 = {
    name = "cumulus-test-sandbox-protected-2"
    type = "protected"
  },
  public = {
    name = "cumulus-test-sandbox-public"
    type = "public"
  }
}
s3_replicator_config = {
  source_bucket = "cumulus-test-sandbox-access-logs"
  source_prefix = "s3_access_logs"
  target_bucket = "cumulus-test-sandbox-access-logs-destination"
  target_prefix = "input/s3_access/sandbox"
  target_region = "us-west-2"
}

system_bucket="cumulus-test-sandbox-internal"

cmr_search_client_config = {
  create_reconciliation_report_cmr_limit = 1500
  create_reconciliation_report_cmr_page_size = 250
}

csdap_client_id = "csdap client id "
csdap_client_password = "csdap client password"
csdap_host_url = "https://auth.csdap.uat.earthdatacloud.nasa.gov"

default_s3_multipart_chunksize_mb = 128

elasticsearch_client_config = {
  create_reconciliation_report_es_scroll_duration = "8m"
  create_reconciliation_report_es_scroll_size = 1500
}

launchpad_api = "https://api.launchpad.nasa.gov/icam/api/sm/v1"
launchpad_certificate = "launchpad.pfx"

oauth_user_group = "GSFC-Cumulus-Dev"

saml_idp_login                  = "https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso"
saml_launchpad_metadata_url     = "https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml"

thin_egress_jwt_secret_name = "cumulus_sandbox_jwt_tea_secret"

orca_default_bucket = "cumulus-test-sandbox-orca-glacier"

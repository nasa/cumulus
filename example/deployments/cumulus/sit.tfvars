buckets = {
  glacier = {
    name = "cumulus-sit-orca-glacier"
    type = "orca"
  },
  internal = {
    name = "cumulus-sit-internal"
    type = "internal"
  }
  private = {
    name = "cumulus-sit-private"
    type = "private"
  },
  protected = {
    name = "cumulus-sit-protected"
    type = "protected"
  },
  protected-2 = {
    name = "cumulus-sit-protected-2"
    type = "protected"
  },
  public = {
    name = "cumulus-sit-public"
    type = "public"
  }
}
s3_replicator_config = {
  source_bucket = ""
  source_prefix = ""
  target_bucket = ""
  target_prefix = ""
}
system_bucket="cumulus-sit-internal"
ftp_host_configuration_bucket = "cumulus-sit-internal"

csdap_client_id = "csdap client id "
csdap_client_password = "csdap client password"
csdap_host_url = "https://auth.csdap.uat.earthdatacloud.nasa.gov"

launchpad_api = "https://api.launchpad.nasa.gov/icam/api/sm/v1"
launchpad_certificate = "launchpad.pfx"

oauth_user_group = "GSFC-Cumulus-Dev"
cmr_oauth_provider = "earthdata"

saml_idp_login                  = "https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso"
saml_launchpad_metadata_url     = "https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml"

thin_egress_jwt_secret_name = "cumulus_sit_jwt_tea_secret"

orca_default_bucket = "cumulus-sit-orca-glacier"

buckets = {
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

launchpad_api = "https://api.launchpad.nasa.gov/icam/api/sm/v1"
launchpad_certificate = "launchpad.pfx"

oauth_user_group = "GSFC-Cumulus-Dev"

saml_idp_login                  = "https://auth.launchpad-sbx.nasa.gov/affwebservices/public/saml2sso"
saml_launchpad_metadata_url     = "https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml"

ems_host              = "fs1.ems.eosdis.nasa.gov"
ems_port              = 22
ems_path              = "tmpNat"
ems_datasource        = "UAT"
ems_private_key       = "ems-private.pem"
ems_provider          = "CUMULUS"
ems_retention_in_days = 30
ems_submit_report     = true
ems_username          = "cumulus"

thin_egress_jwt_secret_name = "cumulus_sit_jwt_tea_secret"

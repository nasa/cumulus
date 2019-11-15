buckets = {
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
  source_bucket = ""
  source_prefix = ""
  target_bucket = ""
  target_prefix = ""
}
system_bucket="cumulus-test-sandbox-internal"

launchpad_api = "https://api.launchpad.nasa.gov/icam/api/sm/v1"
launchpad_certificate = "launchpad.pfx"

oauth_user_group = "GSFC-Cumulus-Dev"

ems_host              = "fs1.ems.eosdis.nasa.gov"
ems_port              = 22
ems_path              = "tmpNat"
ems_datasource        = "UAT"
ems_private_key       = "ems-private.pem"
ems_provider          = "CUMULUS"
ems_retention_in_days = 30
ems_submit_report     = false
ems_username          = "cumulus"

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

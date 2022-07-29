prefix = "jhedman"

cmr_oauth_provider = "launchpad"

system_bucket = "jhedman-internal"
buckets = {
  glacier = {
    name = "cumulus-test-sandbox-orca-glacier"
    type = "orca"
  },
  internal = {
    name = "jhedman-internal"
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
orca_default_bucket     = "cumulus-test-sandbox-orca-glacier"

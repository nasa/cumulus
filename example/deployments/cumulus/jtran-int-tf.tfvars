prefix = "jtran-int-tf"
key_name = "jtran"

cmr_oauth_provider = "launchpad"

system_bucket     = "jtran-int-tf-internal"
buckets = {
  glacier = {
    name = "cumulus-test-sandbox-orca-glacier"
    type = "orca"
  }
  internal = {
    name = "jtran-int-tf-internal"
    type = "internal"
  }
  private = {
    name = "cumulus-test-sandbox-private"
    type = "private"
  }
  protected = {
    name = "cumulus-test-sandbox-protected"
    type = "protected"
  }
  protected-2 = {
    name = "cumulus-test-sandbox-protected-2"
    type = "protected"
  }
  public = {
    name = "cumulus-test-sandbox-public"
    type = "public"
  }
}
orca_default_bucket = "cumulus-test-sandbox-orca-glacier"
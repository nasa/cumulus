prefix = "ppilone-ci-tf"
buckets = {
  dashboard = {
    name = "cumulus-dashboard-sandbox"
    type = "dashboard"
  },
  glacier = {
    name = "ppilone-ci-tf-test-sandbox-orca-glacier"
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

orca_default_bucket = "ppilone-ci-tf-test-sandbox-orca-glacier"
prefix        = "mvd-tf"
system_bucket = "mvd-internal"
buckets = {
  internal = {
    name = "mvd-internal"
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

ems_submit_report = true

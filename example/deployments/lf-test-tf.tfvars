prefix            = "lf-test-tf"
system_bucket     = "lf-internal"
ems_submit_report     = true
buckets = {
  internal = {
    name = "lf-internal"
    type = "internal"
  }
  private = {
    name = "lf-private"
    type = "private"
  }
  protected = {
    name = "lf-protected"
    type = "protected"
  }
  protected-2 = {
    name = "lf-protected-2"
    type = "protected"
  }
  public = {
    name = "lf-cumulus-public"
    type = "public"
  }
}

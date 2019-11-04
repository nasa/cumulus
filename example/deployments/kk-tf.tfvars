prefix = "kk-test-tf"
buckets = {
  internal = {
    name = "kk-test-internal"
    type = "internal"
  }
  private = {
    name = "kk-test-private"
    type = "private"
  },
  protected = {
    name = "kk-test-protected"
    type = "protected"
  },
  public = {
    name = "kk-test-public"
    type = "public"
  }
}
system_bucket     = "kk-test-internal"

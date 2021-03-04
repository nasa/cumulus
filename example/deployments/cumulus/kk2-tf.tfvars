prefix            = "kk2-tf"
system_bucket     = "kk2-tf-internal"
buckets = {
  internal = {
    name = "kk2-tf-internal"
    type = "internal"
  }
  private = {
    name = "kk2-tf-private"
    type = "private"
  },
  protected = {
    name = "kk2-tf-protected"
    type = "protected"
  },
  protected-2 = {
    name = "kk2-tf-protected-2"
    type = "protected"
  },
  public = {
    name = "kk2-tf-public"
    type = "public"
  },
  glacier = {
    name = "kk2-tf-orca-glacier"
    type = "glacier"
  }
}
cmr_oauth_provider = "launchpad"
oauth_provider   = "earthdata"

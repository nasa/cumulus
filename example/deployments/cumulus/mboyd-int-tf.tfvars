prefix = "mboyd-int-tf"
key_name      = "mboyd"
archive_api_port = 4343

cmr_oauth_provider = "launchpad"

buckets = {
  internal = {
    name = "mboyd-int-tf-internal"
    type = "internal"
  }
  private = {
    name = "mboyd-int-tf-private"
    type = "private"
  }
  protected = {
    name = "mboyd-int-tf-protected"
    type = "protected"
  }
  protected-2 = {
    name = "mboyd-int-tf-protected-2"
    type = "protected"
  }
  public = {
    name = "mboyd-int-tf-public"
    type = "public"
  }
}

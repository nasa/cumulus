prefix = "vkn-ci-tf"
key_name      = "vanhk-cumulus-sandbox"
archive_api_port = 4343

system_bucket     = "vkn-ci-tf-internal"
buckets = {
  glacier = {
    name = "cumulus-test-sandbox-orca-glacier"
    type = "orca"
  },
  internal = {
    name = "vkn-ci-tf-internal"
    type = "internal"
  }
  private = {
    name = "vkn-ci-tf-private"
    type = "private"
  }
  protected = {
    name = "vkn-ci-tf-protected"
    type = "protected"
  }
  protected-2 = {
    name = "vkn-ci-tf-protected-2"
    type = "protected"
  }
  public = {
    name = "vkn-ci-tf-public"
    type = "public"
  }
}
orca_default_bucket = "cumulus-test-sandbox-orca-glacier"

prefix            = "jl-tf"
system_bucket     = "jl-test-integration-internal"
buckets = {
  internal = {
    name = "jl-test-integration-internal"
    type = "internal"
  }
  private = {
    name = "jl-test-integration-private"
    type = "private"
  },
  protected = {
    name = "jl-test-integration-protected"
    type = "protected"
  },
  protected-2 = {
    name = "jl-test-integration-protected-2"
    type = "protected"
  },
  public = {
    name = "jl-test-integration-public"
    type = "public"
  }
}
cmr_oauth_provider = "launchpad"
oauth_provider   = "launchpad"

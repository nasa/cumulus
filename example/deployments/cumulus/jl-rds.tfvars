prefix            = "jl-rds"
system_bucket     = "jl-test-integration-internal"
buckets = {
  glacier = {
    name = "jl-test-integration-orca-glacier"
    type = "glacier"
  },
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
oauth_provider   = "earthdata"

archive_api_port = 8000

key_name      = "jl"

include_orca = true
orca_drop_database = "False"

tea_distribution_url = "https://6t8tlndpqg.execute-api.us-east-1.amazonaws.com:7000/DEV/"
cumulus_distribution_url = "https://efvrwke61k.execute-api.us-east-1.amazonaws.com:9000/dev/"

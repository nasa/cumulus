prefix            = "jl-rds-tf"
system_bucket     = "jl-test-integration-internal"
buckets = {
  glacier = {
    name = "jl-test-integration-orca-glacier"
    type = "orca"
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
oauth_provider   = "earthdata"

archive_api_port = 8000

key_name      = "jl"

orca_default_bucket = "jl-test-integration-orca-glacier"

tea_distribution_url = "https://2yzme66sf7.execute-api.us-east-1.amazonaws.com:7000/DEV/"
cumulus_distribution_url = "https://iprjmr5yuc.execute-api.us-east-1.amazonaws.com:9000/dev/"

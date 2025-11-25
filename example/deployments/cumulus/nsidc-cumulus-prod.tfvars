prefix = "nsidc-cumulus-prod"
buckets = {
  internal = {
    name = "opex-nsidc-cumulus-internal"
    type = "internal"
  },
  private = {
    name = "opex-nsidc-cumulus-private"
    type = "private"
  },
  protected = {
    name = "opex-nsidc-cumulus-protected"
    type = "protected"
  },
  public = {
    name = "opex-nsidc-cumulus-public"
    type = "public"
  },
  protected-2 = {
    name = "opex-nsidc-cumulus-protected-2"
    type = "protected"
  },
  glacier = {
    name = "opex-nsidc-cumulus-orca-glacier"
    type = "orca"
  },
  dashboard = {
    name = "opex-nsidc-cumulus-dashboard"
    type = "dashboard"
  }
}
system_bucket = "opex-nsidc-cumulus-internal"
api_reserved_concurrency = 14

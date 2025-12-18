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
archive_api_users = [
    "acyu",
    "awisdom",
    "cbanh",
    "chuang14",
    "cdurbin",
    "ecarton",
    "jasmine",
    "jennyhliu",
    "jmccoy_uat",
    "jnorton1",
    "kkelly",
    "kovarik",
    "mobrien84",
    "nnageswa",
    "npauzenga",
    "terrafirma13",
    "yliu10",
    "hgrams",
    "bishop_ross",
    "marin",
    "viviant",
    "avluu",
    "nathawat",
    "mdcampbell",
    "crumlyd",
    "tbmcknig",
    "ymchen",
    "sflynn",
    "zhutchison"
]
archive_api_url = "https://d3cuh567loctll.cloudfront.net/"
cumulus_distribution_url = "https://djidssf1tx775.cloudfront.net/"
enable_otel_tracing = true

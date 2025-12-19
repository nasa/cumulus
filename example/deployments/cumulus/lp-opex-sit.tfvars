prefix = "lp-opex-sit"
buckets = {
  internal = {
    name = "opex-lp-cumulus-internal"
    type = "internal"
  },
  private = {
    name = "opex-lp-cumulus-private"
    type = "private"
  },
  protected = {
    name = "opex-lp-cumulus-protected"
    type = "protected"
  },
  public = {
    name = "opex-lp-cumulus-public"
    type = "public"
  },
  protected-2 = {
    name = "opex-lp-cumulus-protected-2"
    type = "protected"
  },
  glacier = {
    name = "opex-lp-cumulus-orca-glacier"
    type = "orca"
  },
  dashboard = {
    name = "opex-lp-cumulus-dashboard"
    type = "dashboard"
  }
}
system_bucket = "opex-lp-cumulus-internal"
api_reserved_concurrency = 14
archive_api_users = [
    "acyu",
    "awisdom",
    "cbanh",
    "chuang14",
    "cdurbin",
    "dhudelson",
    "dmsorensen",
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
enable_otel_tracing = true

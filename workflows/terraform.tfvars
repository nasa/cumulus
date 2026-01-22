cma_version = "v2.0.4"

bucket_config_base = {
  # Public buckets
  "opera-browse" = {
    type                = "public"
    intelligent_tiering = true
    logging             = "s3_replicator"
  }

  # Protected buckets
  "opera-products" = {
    type                = "protected"
    intelligent_tiering = true
    logging             = "s3_replicator"
  }

  # Workflow
  "opera-staging" = {
    type                = "workflow"
    intelligent_tiering = true
  }

}

module "archive" {
  source = "../archive"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  ecs_cluster_name = aws_ecs_cluster.default.name

  elasticsearch_arn      = "XXX"
  elasticsearch_hostname = "XXX"

  system_bucket     = var.system_bucket
  public_buckets    = var.public_buckets
  protected_buckets = var.protected_buckets
  private_buckets   = var.private_buckets

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  cmr_client_id   = var.cmr_client_id
  cmr_environment = var.cmr_environment
  cmr_provider    = var.cmr_provider
  cmr_username    = var.cmr_username
  cmr_password    = var.cmr_password

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  # TODO Get these dynamically
  dynamo_tables = {
    AccessTokens    = "${var.prefix}-AccessTokensTable"
    AsyncOperations = "${var.prefix}-AsyncOperationsTable"
    Collections     = "${var.prefix}-CollectionsTable"
    Executions      = "${var.prefix}-ExecutionsTable"
    Granules        = "${var.prefix}-GranulesTable"
    Pdrs            = "${var.prefix}-PdrsTable"
    Providers       = "${var.prefix}-ProvidersTable"
    Rules           = "${var.prefix}-RulesTable"
    Users           = "${var.prefix}-UsersTable"
  }
}

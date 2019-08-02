provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

# module "distribution" {
#   source = "../tf-modules/distribution"

#   prefix        = var.prefix
#   system_bucket = var.system_bucket

#   permissions_boundary_arn = var.permissions_boundary_arn

#   distribution_url = var.distribution_url

#   protected_buckets = var.protected_buckets
#   public_buckets    = var.public_buckets

#   urs_url             = "https://uat.urs.earthdata.nasa.gov"
#   urs_client_id       = var.urs_client_id
#   urs_client_password = var.urs_client_password

#   vpc_id     = var.vpc_id
#   subnet_ids = var.subnet_ids
# }

module "cumulus" {
  source = "../tf-modules/cumulus"

  prefix = var.prefix

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.subnet_ids

  ecs_cluster_instance_subnet_ids = var.subnet_ids
  ecs_cluster_min_size            = 1
  ecs_cluster_desired_size        = 1
  ecs_cluster_max_size            = 2

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  cmr_client_id   = var.cmr_client_id
  cmr_environment = "UAT"
  cmr_username    = var.cmr_username
  cmr_password    = var.cmr_password
  cmr_provider    = var.cmr_provider

  permissions_boundary_arn = var.permissions_boundary_arn

  system_bucket     = var.system_bucket
  public_buckets    = var.public_buckets
  protected_buckets = var.protected_buckets
  private_buckets   = var.private_buckets

  elasticsearch_arn = "XXX"

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

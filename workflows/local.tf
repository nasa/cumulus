locals {
  lambda_subnet_ids = data.aws_subnets.subnet_ids.ids
  lambda_security_group_ids = [aws_security_group.no_ingress_all_egress.id]

  account_id = data.aws_caller_identity.current.account_id
  region = data.aws_region.current.name
  module_prefix = "${var.PREFIX}-opera"
  system_bucket = "${var.PREFIX}-internal"
  default_tags = {
    Deployment = var.PREFIX
  }

  lambda_processing_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.PREFIX}-lambda-processing"

  distribution_url = ""  # Do we need this

  cumulus_remote_state_config = {
    bucket = "${var.PREFIX}-tf-state"  # Do I want to add the last 4 digits of the AWS Account?
    key    = "cumulus/terraform.tfstate"
    region = data.aws_region.current.name
  }

  python_version = "python3.11"
  log_level = "INFO"

    # Merge the bucket_config with base
  # Any new keys options that have maturity specific overrides need to be added here.
  bucket_config = {
    for k in setunion(keys(var.bucket_config_base), keys(var.bucket_config)) : k => {
      # If a new bucket is defined in the maturity specific overrides without
      # a `type` attribute, then `coalesce` will throw a null error.
      type = coalesce(
        # Check the base first here so it can't be overridden.
        try(var.bucket_config_base[k].type, null),
        try(var.bucket_config[k].type, null),
      )
      direct_read_access = try(
        coalesce(
          try(var.bucket_config[k].direct_read_access, null),
          try(var.bucket_config_base[k].direct_read_access, null),
        ),
        null,
      )
      earthdata_gis_access = try(
        coalesce(
          try(var.bucket_config[k].earthdata_gis_access, null),
          try(var.bucket_config_base[k].earthdata_gis_access, null),
        ),
        null,
      )
      intelligent_tiering = try(
        coalesce(
          try(var.bucket_config[k].intelligent_tiering, null),
          try(var.bucket_config_base[k].intelligent_tiering, null),
        ),
        null,
      )
      logging = try(
        coalesce(
          try(var.bucket_config[k].logging, null),
          try(var.bucket_config_base[k].logging, null),
        ),
        null,
      )
      oai = try(
        coalesce(
          try(var.bucket_config[k].oai, null),
          try(var.bucket_config_base[k].oai, null),
        ),
        null,
      )
    }
  }

    # Bucket types. These lists should not overlap
  standard_bucket_names  = toset([for n, cfg in local.bucket_config : "${var.PREFIX}-${n}" if cfg.type == "standard"])
  protected_bucket_names = toset([for n, cfg in local.bucket_config : "${var.PREFIX}-${n}" if cfg.type == "protected"])
  public_bucket_names    = toset([for n, cfg in local.bucket_config : "${var.PREFIX}-${n}" if cfg.type == "public"])
  workflow_bucket_names  = toset([for n, cfg in local.bucket_config : "${var.PREFIX}-${n}" if cfg.type == "workflow"])

      dar_yes_tags = {
    DAR = "YES"
  }
  dar_no_tags = {
    DAR = "NO"
  }

    base_bucket_map = {
    for n, cfg in local.bucket_config : n => {
      name = "${var.PREFIX}-${n}"
      type = cfg.type == "standard" ? n : cfg.type
    }
  }
  internal_bucket_map = {
    internal = {
      name = "${var.PREFIX}-internal"
      type = "internal"
    }
  }

  bucket_map = merge(
    local.base_bucket_map,
    local.internal_bucket_map,
  )
}


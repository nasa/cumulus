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
}


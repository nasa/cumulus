locals {
  tea_stack_name = "${var.prefix}-thin-egress-app"
  tea_stage_name = "DEV"
}

# UPGRADE NOTE: When upgrading the TEA module version, use a two-phase apply to
# prevent rollback failures caused by Terraform destroying old lambda S3 objects
# before the CloudFormation stack update completes.
#
# Phase 1 — upload new S3 objects and update CF stack (keeps old S3 objects intact
#            as rollback targets if the CF update fails):
#
#   terraform apply \
#     -target=module.thin_egress_app.aws_s3_object.cloudformation_template \
#     -target=module.thin_egress_app.aws_s3_object.lambda_source \
#     -target=module.thin_egress_app.aws_s3_object.lambda_code_dependency_archive \
#     -target=module.thin_egress_app.aws_s3_bucket.lambda_source \
#     -target=module.thin_egress_app.aws_cloudformation_stack.thin_egress_app \
#     -var-file=env/sandbox.tfvars
#
# Phase 2 — full apply to clean up old S3 objects and apply remaining changes:
#
#   terraform apply -var-file=env/sandbox.tfvars
#
# Known issue: upgrading from 1.3.2 to 3.0.0 will fail on EgressStage with
# "Invalid stage identifier" because CF deletes the old EgressAPIdeployment334624
# resource before updating EgressStage, which removes the DEV API Gateway stage.
# If this happens:
#   1. Run continue-update-rollback skipping EgressLambda BumperLambda UpdatePolicyLambda
#   2. Run continue-update-rollback skipping EgressStage
#   3. Recreate the DEV stage: aws apigateway create-stage --rest-api-id <id>
#        --stage-name DEV --deployment-id <old_deployment_id>
#   4. Re-run Phase 1 apply above

resource "aws_secretsmanager_secret" "thin_egress_urs_creds" {
  name_prefix = "${var.prefix}-tea-urs-creds-"
  description = "URS credentials for the ${var.prefix} Thin Egress App"
  tags        = local.tags
}

resource "aws_secretsmanager_secret_version" "thin_egress_urs_creds" {
  secret_id = aws_secretsmanager_secret.thin_egress_urs_creds.id
  secret_string = jsonencode({
    UrsId   = var.urs_client_id
    UrsAuth = base64encode("${var.urs_client_id}:${var.urs_client_password}")
  })
}

resource "aws_s3_bucket_object" "bucket_map_yaml" {
  bucket = var.system_bucket
  key    = "${var.prefix}/thin-egress-app/bucket_map.yaml"
  content = templatefile("${path.module}/thin-egress-app/bucket_map.yaml.tmpl", {
    protected_buckets = local.protected_bucket_names,
    public_buckets    = local.public_bucket_names
  })
  etag = md5(templatefile("${path.module}/thin-egress-app/bucket_map.yaml.tmpl", {
    protected_buckets = local.protected_bucket_names,
    public_buckets    = local.public_bucket_names
  }))
  tags = var.tags
}

module "thin_egress_app" {
  source = "s3::https://s3.amazonaws.com/asf.public.code/thin-egress-app/tea-terraform-build.3.0.0.zip"

  auth_base_url                 = "https://uat.urs.earthdata.nasa.gov"
  bucket_map_file               = aws_s3_bucket_object.bucket_map_yaml.id
  bucketname_prefix             = ""
  config_bucket                 = var.system_bucket
  domain_name                   = var.tea_distribution_url == null ? null : replace(replace(var.tea_distribution_url, "/^https?:///", ""), "//$/", "")
  jwt_secret_name               = var.thin_egress_jwt_secret_name
  permissions_boundary_name     = var.permissions_boundary_arn == null ? null : reverse(split("/", var.permissions_boundary_arn))[0]
  private_vpc                   = local.vpc_id
  stack_name                    = local.tea_stack_name
  stage_name                    = local.tea_stage_name
  urs_auth_creds_secret_name    = aws_secretsmanager_secret.thin_egress_urs_creds.name
  vpc_subnet_ids                = local.subnet_ids
  log_api_gateway_to_cloudwatch = var.log_api_gateway_to_cloudwatch
  tags                          = local.tags
}

resource "aws_cloudwatch_log_subscription_filter" "egress_api_gateway_log_subscription_filter" {
  count           = (var.log_api_gateway_to_cloudwatch && var.log_destination_arn != null) ? 1 : 0
  name            = "${var.prefix}-EgressApiGatewayCloudWatchLogSubscriptionToSharedDestination"
  distribution    = "ByLogStream"
  destination_arn = var.log_destination_arn
  filter_pattern  = ""
  log_group_name  = module.thin_egress_app.egress_log_group
}

# Egress Lambda Log Group
resource "aws_cloudwatch_log_group" "egress_lambda_log_group" {
  count             = (var.log_destination_arn != null) ? 1 : 0
  name              = "/aws/lambda/${module.thin_egress_app.egress_lambda_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "thin-egress-app-EgressLambda", var.default_log_retention_days)
  tags              = var.tags
}

# Egress Lambda Log Group Filter
resource "aws_cloudwatch_log_subscription_filter" "egress_lambda_log_subscription_filter" {
  count           = (var.log_destination_arn != null) ? 1 : 0
  depends_on      = [aws_cloudwatch_log_group.egress_lambda_log_group]
  name            = "${var.prefix}-EgressLambdaLogSubscriptionToSharedDestination"
  destination_arn = var.log_destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = aws_cloudwatch_log_group.egress_lambda_log_group[0].name
}

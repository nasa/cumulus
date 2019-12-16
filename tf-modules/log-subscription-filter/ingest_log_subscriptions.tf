resource "aws_cloudwatch_log_subscription_filter" "discover_pdrs_task_log_subscription_filter" {
  name            = "${var.prefix}-DiscoverPDRsTaskLogSubscriptionToSharedDestination"
  destination_arn = local.destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = var.discover_pdrs_task
}

resource "aws_cloudwatch_log_subscription_filter" "parse_pdr_task_log_subscription_filter" {
  name            = "${var.prefix}-ParsePDRTaskLogSubscriptionToSharedDestination"
  destination_arn = local.destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = var.parse_pdr_task
}

resource "aws_cloudwatch_log_subscription_filter" "post_to_cmr_task_log_subscription_filter" {
  name            = "${var.prefix}-PostToCMRTaskLogSubscriptionToSharedDestination"
  destination_arn = local.destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = var.post_to_cmr_task
}

resource "aws_cloudwatch_log_subscription_filter" "queue_pdrs_task_log_subscription_filter" {
  name            = "${var.prefix}-QueuePDRsTaskLogSubscriptionToSharedDestination"
  destination_arn = local.destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = var.queue_pdrs_task
}

resource "aws_cloudwatch_log_subscription_filter" "sync_granule_task_log_subscription_filter" {
  name            = "${var.prefix}-SyncGranuleTaskLogSubscriptionToSharedDestination"
  destination_arn = local.destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = var.sync_granule_task
}

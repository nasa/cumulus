resource "aws_cloudwatch_log_subscription_filter" "additional_task_log_subscription_filter" {
  for_each        = var.additional_log_groups_to_elk
  name            = "${var.prefix}-${each.key}LogSubscriptionToSharedDestination"
  destination_arn = var.log_destination_arn
  distribution    = "ByLogStream"
  filter_pattern  = ""
  log_group_name  = each.value
}

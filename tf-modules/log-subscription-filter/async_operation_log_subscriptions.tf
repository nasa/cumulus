resource "aws_cloudwatch_log_subscription_filter" "async_operation_ecs_log" {
  name            = "${var.prefix}-AsyncOperationEcsLogSubscription"
  destination_arn = var.log_destination_arn
  log_group_name  = var.async_operation_log_group
  filter_pattern  = ""
  distribution    = "ByLogStream"
}

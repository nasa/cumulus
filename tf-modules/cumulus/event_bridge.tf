resource "aws_cloudwatch_event_bus" "cumulus_event_bus" {
  name = "${var.prefix}-cumulus-event-bus"
  tags = var.tags
}

locals {
  aws_account_id = data.aws_caller_identity.current.account_id
  aws_region     = data.aws_region.current.name
  event_bus_name = "${var.prefix}-cumulus-event-bus"
}
resource "aws_cloudwatch_event_bus" "cumulus_event_bus" {
  name = local.event_bus_name
  tags = var.tags
}

resource "aws_iam_role" "cross_bus_router_role" {
  name = "${var.prefix}-eb-cross-bus-router-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = ["events.amazonaws.com"]
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "cross_bus_router_policy" {
  name = "${var.prefix}-eb-cross-bus-router-policy"
  role = aws_iam_role.cross_bus_router_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "events:PutEvents"
      Resource = aws_cloudwatch_event_bus.cumulus_event_bus.arn
    }]
  })
}

resource "aws_cloudwatch_event_rule" "forward_to_custom_bus" {
  name           = "${var.prefix}-sfn-execution-forwarder"
  event_bus_name = "default"
  description    = "Forwards Step Function execution events matching the stack prefix to the custom event bus."

  event_pattern = jsonencode({
    source      = ["aws.states"]
    detail-type = ["Step Functions Execution Status Change"]
    detail = {
      stateMachineArn = [{
        prefix = "arn:aws:states:${local.aws_region}:${local.aws_account_id}:stateMachine:${var.prefix}-"
      }]
    }
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "forward_target" {
  target_id      = "forward_sfn_to_cumulus_custom_bus"
  rule           = aws_cloudwatch_event_rule.forward_to_custom_bus.name
  event_bus_name = "default"
  arn            = aws_cloudwatch_event_bus.cumulus_event_bus.arn
  role_arn       = aws_iam_role.cross_bus_router_role.arn
}

terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

resource "aws_cloudwatch_dashboard" "cloudwatch_dashboard" {
  dashboard_name = "${var.prefix}-CloudWatch-Dashboard"
  dashboard_body = <<EOF
  {
    "widgets": [
      {
        "type": "text",
        "width": 24,
        "height": 1,
        "properties": {
          "markdown": "# Elasticsearch Service"
        }
      },
      {
        "type": "text",
        "width": 24,
        "height": 1,
        "properties": {
          "markdown": "## Alarms"
        }
      }
      %{for alarm in var.elasticsearch_alarms}
      ,
      {
        "type":"metric",
        "width":6,
        "height":3,
        "properties": {
          "title": "${alarm.name}",
          "annotations": {
            "alarms": ["${alarm.arn}"]
          },
          "view": "singleValue"
        }
      }
      %{endfor}
      ,
      {
        "type": "text",
        "width": 24,
        "height": 1,
        "properties": {
          "markdown": "# Elastic Container Service"
        }
      },
      {
        "type": "text",
        "width": 24,
        "height": 1,
        "properties": {
          "markdown": "## Alarms"
        }
      }
      %{for alarm in var.ecs_service_alarms}
      ,
      {
        "type":"metric",
        "width":6,
        "height":3,
        "properties": {
          "title": "${alarm.name}",
          "annotations": {
            "alarms": ["${alarm.arn}"]
          },
          "view": "singleValue"
        }
      }
      %{endfor}
   ]
  }
  EOF
}

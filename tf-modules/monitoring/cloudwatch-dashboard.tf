terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100"
    }
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

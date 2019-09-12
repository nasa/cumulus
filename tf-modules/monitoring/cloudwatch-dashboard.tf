
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
      },
      {
        "type":"metric",
        "width":6,
        "height":3,
        "properties": {
          "title": "${var.elasticsearch_alarms[0].name}",
          "annotations": {
            "alarms": ["${var.elasticsearch_alarms[0].arn}"]
          },
          "view": "singleValue"
        }
      },
      {
        "type":"metric",
        "width":6,
        "height":3,
        "properties": {
          "title": "${var.elasticsearch_alarms[1].name}",
          "annotations": {
            "alarms": ["${var.elasticsearch_alarms[1].arn}"]
          },
          "view": "singleValue"
        }
      }    
   ]
  }
  EOF
}

# Report executions
resource "aws_sns_topic" "report_executions_topic" {
  name = "${var.prefix}-report-executions-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_executions_topic_policy" {
  arn = aws_sns_topic.report_executions_topic.arn
  policy = data.aws_iam_policy_document.report_execution_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_execution_sns_topic_policy" {
  statement {
    actions = [
      "SNS:GetTopicAttributes",
      "SNS:SetTopicAttributes",
      "SNS:AddPermission",
      "SNS:RemovePermission",
      "SNS:DeleteTopic",
      "SNS:Subscribe",
      "SNS:ListSubscriptionsByTopic",
      "SNS:Publish"
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_executions_topic.arn,
    ]

    sid = "__default_statement_ID"
  }
  dynamic "statement" {
    for_each = var.report_sns_topic_subscriber_arns != null ? [1] : []
    content {
      actions = [
        "sns:Subscribe",
      ]
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = distinct(compact(var.report_sns_topic_subscriber_arns))
      }
      resources = [
        aws_sns_topic.report_executions_topic.arn,
      ]
      sid = "subscriberStatementId"
    }
  }
}

# Report granules
resource "aws_sns_topic" "report_granules_topic" {
  name = "${var.prefix}-report-granules-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_granules_topic_policy" {
  arn = aws_sns_topic.report_granules_topic.arn
  policy = data.aws_iam_policy_document.report_granules_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_granules_sns_topic_policy" {
  statement {
    actions = [
      "SNS:GetTopicAttributes",
      "SNS:SetTopicAttributes",
      "SNS:AddPermission",
      "SNS:RemovePermission",
      "SNS:DeleteTopic",
      "SNS:Subscribe",
      "SNS:ListSubscriptionsByTopic",
      "SNS:Publish"
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_granules_topic.arn,
    ]

    sid = "__default_statement_ID"
  }
  dynamic "statement" {
    for_each = var.report_sns_topic_subscriber_arns != null ? [1] : []
    content {
      actions = [
        "sns:Subscribe",
      ]
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = distinct(compact(var.report_sns_topic_subscriber_arns))
      }
      resources = [
        aws_sns_topic.report_granules_topic.arn,
      ]
      sid = "subscriberStatementId"
    }
  }
}

# Report PDRs
resource "aws_sns_topic" "report_pdrs_topic" {
  name = "${var.prefix}-report-pdrs-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_pdrs_topic_policy" {
  arn = aws_sns_topic.report_pdrs_topic.arn
  policy = data.aws_iam_policy_document.report_pdrs_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_pdrs_sns_topic_policy" {
  statement {
    actions = [
      "SNS:GetTopicAttributes",
      "SNS:SetTopicAttributes",
      "SNS:AddPermission",
      "SNS:RemovePermission",
      "SNS:DeleteTopic",
      "SNS:Subscribe",
      "SNS:ListSubscriptionsByTopic",
      "SNS:Publish"
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_pdrs_topic.arn,
    ]

    sid = "__default_statement_ID"
  }

  dynamic "statement" {
    for_each = var.report_sns_topic_subscriber_arns != null ? [1] : []
    content {
      actions = [
        "sns:Subscribe",
      ]
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = distinct(compact(var.report_sns_topic_subscriber_arns))
      }
      resources = [
        aws_sns_topic.report_pdrs_topic.arn,
      ]
      sid = "subscriberStatementId"
    }
  }
}
# Report collections
resource "aws_sns_topic" "report_collections_topic" {
  name = "${var.prefix}-report-collections-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_collections_topic_policy" {
  arn = aws_sns_topic.report_collections_topic.arn
  policy =  data.aws_iam_policy_document.report_collections_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_collections_sns_topic_policy" {
  statement {
    actions = [
      "SNS:GetTopicAttributes",
      "SNS:SetTopicAttributes",
      "SNS:AddPermission",
      "SNS:RemovePermission",
      "SNS:DeleteTopic",
      "SNS:Subscribe",
      "SNS:ListSubscriptionsByTopic",
      "SNS:Publish"
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_collections_topic.arn,
    ]

    sid = "__default_statement_ID"
  }
  dynamic "statement" {
    for_each = var.report_sns_topic_subscriber_arns != null ? [1] : []
    content {
      actions = [
        "sns:Subscribe",
      ]
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = distinct(compact(var.report_sns_topic_subscriber_arns))
      }
      resources = [
        aws_sns_topic.report_collections_topic.arn,
      ]
      sid = "subscriberStatementId"
    }
  }
}

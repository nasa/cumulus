data "aws_iam_policy_document" "opera_workflow_sqs_policy" {
  policy_id = "${local.module_prefix}-workflow-policy-id"
  statement {
    sid    = "CurrentAccountSendMessage"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [data.aws_caller_identity.current.account_id]
    }
    actions = [
      "sqs:SendMessage"
    ]
    resources = [
      aws_sqs_queue.workflow_queue.arn
    ]
  }
}

data "aws_iam_policy_document" "opera_mock_response_sqs_policy" {
  policy_id = "${local.module_prefix}-mock-response-sqs-policy"
  statement {
    sid    = "CurrentAccountSendMessage"
    effect = "Allow"
    principals {
      type = "AWS"
      identifiers = [
        data.aws_caller_identity.current.account_id
      ]
    }
    actions = [
      "sqs:SendMessage"
    ]
    resources = [
      aws_sqs_queue.mock_response_queue.arn
    ]
  }
}

data "aws_iam_policy_document" "opera_cnm_logger_sqs_policy" {
  policy_id = "${local.module_prefix}-cnm-logger-policy-id"
  statement {
    sid    = "CurrentAccountSendMessage"
    effect = "Allow"
    principals {
      type = "AWS"
      identifiers = concat(
        [data.aws_caller_identity.current.account_id]
      )
    }
    actions = [
      "sqs:SendMessage"
    ]
    resources = [
      aws_sqs_queue.cnm_logger_queue.arn
    ]
  }
}

data "aws_iam_policy_document" "lambda_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

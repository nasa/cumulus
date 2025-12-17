resource "aws_sqs_queue" "cnm_logger_dlq" {
  name                      = "${local.module_prefix}-cnm-ingest-queue-dlq"
  message_retention_seconds = 60 * 60 * 24
}

resource "aws_sqs_queue" "cnm_logger_queue" {
  name                       = "${local.module_prefix}-cnm-ingest-queue"
  visibility_timeout_seconds = 60 * 5
  message_retention_seconds  = 60 * 60 * 24
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.cnm_logger_dlq.arn
    maxReceiveCount     = var.workflow_max_receive_count
  })
}

resource "aws_sqs_queue_policy" "cnm_logger_sqs_policy" {
  queue_url = aws_sqs_queue.cnm_logger_queue.id
  policy    = data.aws_iam_policy_document.opera_cnm_logger_sqs_policy.json
}

resource "aws_sqs_queue" "mock_response_queue" {
  name                       = "${local.module_prefix}-mock-response-queue"
  visibility_timeout_seconds = 60 * 5
  message_retention_seconds  = 60 * 60 * 24
}

resource "aws_sqs_queue" "workflow_dlq" {
  name                       = "${local.module_prefix}-workflow-queue-dlq"
  message_retention_seconds  = 60 * 60 * 24 * 7
  visibility_timeout_seconds = 60 * 5
}

resource "aws_sqs_queue" "workflow_queue" {
  name                       = "${local.module_prefix}-workflow-queue"
  visibility_timeout_seconds = 60 * 5
  message_retention_seconds  = 60 * 60 * 24
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.workflow_dlq.arn
    maxReceiveCount     = var.workflow_max_receive_count
  })
}

resource "aws_sqs_queue_policy" "workflow_sqs_policy" {
  queue_url = aws_sqs_queue.workflow_queue.id
  policy    = data.aws_iam_policy_document.opera_workflow_sqs_policy.json
}

resource "aws_sqs_queue_policy" "mock_response_sqs_policy" {
  queue_url = aws_sqs_queue.mock_response_queue.url
  policy    = data.aws_iam_policy_document.opera_mock_response_sqs_policy.json
}

resource "aws_sqs_queue" "dedupe_granules_queue" {
  name                       = "${local.module_prefix}-dedupe-granules-queue"
  visibility_timeout_seconds = aws_lambda_function.dedupe_send_to_queue.timeout
  message_retention_seconds  = 60 * 60 * 24
}

# Bignbit
resource "aws_sqs_queue" "mock_gitc_input_queue" {
  count = var.MATURITY == "sbx" ? 1 : 0

  name                        = "${var.PREFIX}-fake-gitc-IN.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  tags                        = local.default_tags
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.mock_gitc_input_deadletter[0].arn
    maxReceiveCount     = 4
  })
}

resource "aws_sqs_queue" "mock_gitc_input_deadletter" {
  count = var.MATURITY == "sbx" ? 1 : 0

  name                        = "${var.PREFIX}-fake-gitc-IN-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = ["arn:aws:sqs:${data.aws_region.current.name}:${local.account_id}:${var.PREFIX}-fake-gitc-IN.fifo"]
  })
}

resource "aws_sqs_queue" "queue_browse_to_bignbit" {
  name                       = "${var.PREFIX}-queueBrowseToBignbitThrottledQueue"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
}

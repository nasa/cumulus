# Report executions
resource "aws_sns_topic" "report_executions_topic" {
  name = "${var.prefix}-report-executions-topic"
  tags = var.tags
}
# Report granules
resource "aws_sns_topic" "report_granules_topic" {
  name = "${var.prefix}-report-granules-topic"
  tags = var.tags
}

# Report PDRs
resource "aws_sns_topic" "report_pdrs_topic" {
  name = "${var.prefix}-report-pdrs-topic"
  tags = var.tags
}

# Report collections
resource "aws_sns_topic" "report_collections_topic" {
  name = "${var.prefix}-report-collections-topic"
  tags = var.tags
}

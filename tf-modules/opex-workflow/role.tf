resource "aws_iam_role" "dedupe_execution_role" {
  name = "${local.module_prefix}-dedupe-execution-role"

  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/NGAPShRoleBoundary"
}

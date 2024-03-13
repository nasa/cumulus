data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "glue_execution_assume_role_policy" {
  statement {
    sid     = ""
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["glue.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "data_lake_policy" {
  #  name        = "EventBridgeLambdaPolicy"
  #  description = "IAM policy for allowing EventBridge to invoke any Lambda function"
  statement {

    effect    = "Allow"
    resources = ["arn:aws:s3:::${var.system_bucket}/*", "arn:aws:s3:::${var.system_bucket}"]

    actions = ["s3:Put*",
                "s3:Get*",
                "s3:Delete*"]
  }

  statement {
    effect    = "Allow"
    resources = [
                 "arn:aws:s3:::${var.system_bucket}"]

    actions = ["s3:ListBucket"]
  }
  statement {
     effect    = "Allow"
     resources = [
      "arn:aws:glue:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:catalog",
      "arn:aws:glue:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:database/${local.athena_database_name}",
      "arn:aws:glue:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${local.athena_database_name}/*",
     ]
     actions =  [
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetConnection",
        "glue:GetTable",
        "glue:GetTables",
        "glue:GetPartition",
        "glue:GetPartitions",
        "glue:BatchCreatePartition"
      ]
  }
  statement {
    actions = [
       "lakeformation:*",
    ]
    resources = ["*"]
  }
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

}

resource "aws_iam_policy" "data_lake_access_policy" {
  name        = "s3DataLakePolicy-${var.system_bucket}"
  description = "allows for running glue job in the glue console and access my s3_bucket"
  policy      = data.aws_iam_policy_document.data_lake_policy.json
}


resource "aws_iam_role" "glue_service_role" {
name = "aws_glue_job_runner"
assume_role_policy = data.aws_iam_policy_document.glue_execution_assume_role_policy.json
}

resource "aws_iam_role_policy_attachment" "data_lake_permissions" {
  role = aws_iam_role.glue_service_role.name
  policy_arn = aws_iam_policy.data_lake_access_policy.arn
}


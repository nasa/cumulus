resource "aws_lambda_function" "provision_database" {
  count = var.provision_user_database ? 1 : 0
  function_name    = "${var.prefix}-ProvisionDatabase"
  description      = "Bootstrap lambda that adds user/database to RDS database"
  filename         = "${path.module}/provision_database/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/provision_database/lambda.zip")
  handler          = "index.handler"
  role             = aws_iam_role.db_provision[0].arn
  runtime          = "nodejs12.x"
  memory_size      = 256
  timeout          = 500
  environment {
    variables = {
      dbHeartBeat = "true"
    }
  }
  dynamic "vpc_config" {
    for_each = length(var.subnets) == 0 ? [] : [1]
    content {
      subnet_ids         = var.subnets
      security_group_ids = [aws_security_group.rds_cluster_access.id, aws_security_group.db_provision[0].id]
    }
  }
  tags = var.tags
}


resource "aws_security_group" "db_provision" {
  count = var.provision_user_database ? 1 : 0

  name_prefix = "${var.prefix}-db-provision"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_iam_role" "db_provision" {
  count = var.provision_user_database ? 1 : 0
  name_prefix          = "${var.prefix}_db_provision"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy[0].json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

resource "aws_iam_role_policy" "db_provision" {
  count = var.provision_user_database ? 1 : 0
  name_prefix = "${var.prefix}_db_provision"
  role        = aws_iam_role.db_provision[0].id
  policy      = data.aws_iam_policy_document.db_provision[0].json
}

resource "aws_secretsmanager_secret" "db_credentials" {
  count = var.provision_user_database ? 1 : 0
  name_prefix = "${var.prefix}_db_login"
  description = "Database Credentials Object for ${var.prefix} stack"
  tags        = var.tags
}

data "aws_iam_policy_document" "lambda_assume_role_policy" {
  count = var.provision_user_database ? 1 : 0
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

data "aws_iam_policy_document" "db_provision" {
  count = var.provision_user_database ? 1 : 0
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:CreateSecret",
      "secretsmanager:PutSecretValue"
    ]
    resources = [aws_secretsmanager_secret.db_credentials[0].arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret_version.rds_login.arn]
  }
}

data "aws_lambda_invocation" "provision_database" {
  count = var.provision_user_database ? 1 : 0
  depends_on    = [aws_lambda_function.provision_database]
  function_name = aws_lambda_function.provision_database[0].function_name
  input = jsonencode({ prefix = var.prefix,
    rootLoginSecret    = aws_secretsmanager_secret_version.rds_login.arn,
    userLoginSecret    = aws_secretsmanager_secret.db_credentials[0].name
    dbPassword         = var.rds_user_password
    replacementTrigger = timestamp()
  })
}

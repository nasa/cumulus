module "version_up_test" {
  source = "../../tf-modules/workflow_task"

  prefix        = var.prefix
  system_bucket = var.system_bucket
  task_version  = var.task_version

  function_name = "VersionUpTest"
  filename = "${path.module}/../lambdas/versionUpTest/lambda.zip"

  handler               = "index.handler"
  role                  = module.cumulus.lambda_processing_role_arn
  runtime               = "nodejs8.10"

  subnet_ids            = var.subnet_ids
  security_group_ids    = [aws_security_group.no_ingress_all_egress.id]

  enable_versioning = true

  tags = local.default_tags
}

module "test_lambda_version_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "TestLambdaVersionWorkflow"
  workflow_config                       = module.cumulus.workflow_config
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Tests Lambda update after redeploy",
  "StartAt": "WaitForDeployment",
  "States": {
    "WaitForDeployment": {
      "Type": "Task",
      "Resource": "${module.version_up_test.task_arn}",
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "WorkflowFailed"
        }
      ],
      "End": true
    },
    "WorkflowFailed": {
      "Type": "Fail",
      "Cause": "Workflow failed"
    }
  }
}
JSON
}

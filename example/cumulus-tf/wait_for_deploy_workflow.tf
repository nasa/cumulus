module "wait_for_deploy_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "WaitForDeployWorkflow"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Tests redeployment during workflow run",
  "StartAt": "HelloWorld",
  "States": {
    "HelloWorld": {
      "Type": "Task",
      "Resource": "${module.cumulus.hello_world_task.task_arn}",
      "Next": "WaitForS3ObjectToExist"
    },
    "WaitForS3ObjectToExist": {
      "Type": "Task",
      "Resource": "${aws_lambda_function.wait_for_s3_object_to_exist.arn}",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
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

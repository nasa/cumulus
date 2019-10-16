module "retry_pass_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "RetryPassWorkflow"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  publish_reports_lambda_function_arn   = module.cumulus.publish_reports_lambda_function_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  state_machine_definition = <<JSON
{
  "Comment": "Tests Retry Configurations",
  "StartAt": "HelloWorld",
  "States": {
    "HelloWorld": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "fail": true,
            "passOnRetry": true,
            "bucket": "{$.meta.buckets.internal.name}",
            "execution": "{$.cumulus_meta.execution_name}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.hello_world_task_lambda_function_arn}",
      "Retry": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 3
        }
      ],
      "End": true
    }
  }
}
JSON
}

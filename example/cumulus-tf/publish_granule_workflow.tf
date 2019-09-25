module "publish_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "PublishGranule"
  distribution_url                      = module.cumulus.distribution_url
  state_machine_role_arn                = module.cumulus.step_role_arn
  sf_semaphore_down_lambda_function_arn = module.cumulus.sf_semaphore_down_lambda_function_arn
  sftracker_sns_topic_arn               = module.cumulus.sftracker_sns_topic_arn
  system_bucket                         = var.system_bucket
  tags                                  = local.default_tags

  workflow_config = <<JSON
{
  "Report": {
    "cumulus_message": {
      "input": "{{$}}"
    }
  },
  "CmrStep": {
    "bucket": "{{$.meta.buckets.internal.name}}",
    "stack": "{{$.meta.stack}}",
    "cmr": "{{$.meta.cmr}}",
    "process": "N/A"
  },
  "StopStatus": {
    "sfnEnd": true,
    "stack": "{{$.meta.stack}}",
    "bucket": "{{$.meta.buckets.internal.name}}",
    "stateMachine": "{{$.cumulus_meta.state_machine}}",
    "executionName": "{{$.cumulus_meta.execution_name}}",
    "cumulus_message": {
      "input": "{{$}}"
    }
  },
  "WorkflowFailed": {}
}
JSON

  state_machine_definition = jsonencode({
    Comment = "Publish Granule"
    StartAt = "Report"
    States = {
      Report = {
        Type     = "Task"
        Resource = module.cumulus.sf_sns_report_task_lambda_function_arn
        Retry = [
          {
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException"
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
            BackoffRate     = 2
          }
        ]
        Next = "CmrStep"
      }
      CmrStep = {
        Type     = "Task"
        Resource = module.cumulus.post_to_cmr_task_lambda_function_arn
        Retry = [
          {
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException"
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.exception"
            Next        = "StopStatus"
          }
        ]
        Next = "StopStatus"
      }
      StopStatus = {
        Type     = "Task",
        Resource = module.cumulus.sf_sns_report_task_lambda_function_arn
        Retry = [
          {
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException"
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "WorkflowFailed"
          }
        ]
        End = true
      }
      WorkflowFailed = {
        Type  = "Fail",
        Cause = "Workflow failed"
      }
    }
  })
}

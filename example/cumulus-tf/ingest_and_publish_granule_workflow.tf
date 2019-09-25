module "ingest_and_publish_granule_workflow" {
  source = "../../tf-modules/workflow"

  prefix                                = var.prefix
  name                                  = "IngestAndPublishGranule"
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
  "SyncGranule": {
    "buckets": "{{$.meta.buckets}}",
    "provider": "{{$.meta.provider}}",
    "collection": "{{$.meta.collection}}",
    "stack": "{{$.meta.stack}}",
    "downloadBucket": "{{$.cumulus_meta.system_bucket}}",
    "duplicateHandling": "{{$.meta.collection.duplicateHandling}}",
    "pdr": "{{$.meta.pdr}}",
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$.granules}}",
          "destination": "{{$.meta.input_granules}}"
        },
        {
          "source": "{{$}}",
          "destination": "{{$.payload}}"
        },
        {
          "source": "{{$.process}}",
          "destination": "{{$.cumulus_meta.process}}"
        }
      ]
    }
  },
  "ChooseProcess": {},
  "ProcessingStep": {
    "bucket": "{{$.meta.buckets.internal.name}}",
    "collection": "{{$.meta.collection}}",
    "cmrMetadataFormat": "{{$.meta.cmrMetadataFormat}}",
    "additionalUrls": "{{$.meta.additionalUrls}}",
    "cumulus_message": {
      "outputs": [
        {
          "source": "{{$.files}}",
          "destination": "{{$.payload}}"
        }
      ]
    }
  },
  "FilesToGranulesStep": {
    "inputGranules": "{{$.meta.input_granules}}",
    "granuleIdExtraction": "{{$.meta.collection.granuleIdExtraction}}"
  },
  "MoveGranuleStep": {
    "bucket": "{{$.meta.buckets.internal.name}}",
    "buckets": "{{$.meta.buckets}}",
    "distribution_endpoint": "{{$.meta.distribution_endpoint}}",
    "collection": "{{$.meta.collection}}",
    "duplicateHandling": "{{$.meta.collection.duplicateHandling}}"
  },
  "CmrStep": {
    "bucket": "{{$.meta.buckets.internal.name}}",
    "stack": "{{$.meta.stack}}",
    "cmr": "{{$.meta.cmr}}",
    "process": "{{$.cumulus_meta.process}}"
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
    Comment = "Ingest Granule"
    StartAt = "Report"

    States = {
      Report = {
        Next       = "SyncGranule"
        Resource   = module.cumulus.sf_sns_report_task_lambda_function_arn
        ResultPath = null
        Retry = [
          {
            BackoffRate = 2
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
          },
        ]
        Type = "Task"
      }

      SyncGranule = {
        Catch = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            Next       = "StopStatus"
            ResultPath = "$.exception"
          },
        ]
        Next     = "ChooseProcess"
        Resource = module.cumulus.sync_granule_task_lambda_function_arn
        Retry = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            IntervalSeconds = 2
            MaxAttempts     = 3
          },
        ]
        Type = "Task"
      }

      ChooseProcess = {
        Choices = [
          {
            Next         = "ProcessingStep"
            StringEquals = "modis"
            Variable     = "$.cumulus_meta.process"
          },
        ]
        Default = "StopStatus"
        Type    = "Choice"
      }

      ProcessingStep = {
        Catch = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            Next       = "StopStatus"
            ResultPath = "$.exception"
          },
        ]
        Next     = "FilesToGranulesStep"
        Resource = module.cumulus.fake_processing_task_lambda_function_arn
        Retry = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            IntervalSeconds = 2
            MaxAttempts     = 3
          },
        ]
        Type = "Task"
      }

      FilesToGranulesStep = {
        Catch = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            Next       = "StopStatus"
            ResultPath = "$.exception"
          },
        ]
        Next     = "MoveGranuleStep"
        Resource = module.cumulus.files_to_granules_task_lambda_function_arn
        Retry = [
          {
            BackoffRate = 2
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
          },
        ]
        Type = "Task"
      }

      MoveGranuleStep = {
        Catch = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            Next       = "StopStatus"
            ResultPath = "$.exception"
          },
        ]
        Next     = "CmrStep"
        Resource = module.cumulus.move_granules_task_lambda_function_arn
        Retry = [
          {
            BackoffRate = 2
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
          },
        ]
        Type = "Task"
      }

      CmrStep = {
        Catch = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            Next       = "StopStatus"
            ResultPath = "$.exception"
          },
        ]
        Next     = "StopStatus"
        Resource = module.cumulus.post_to_cmr_task_lambda_function_arn
        Retry = [
          {
            BackoffRate = 2
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
          },
        ]
        Type = "Task"
      }

      StopStatus = {
        Catch = [
          {
            ErrorEquals = [
              "States.ALL",
            ]
            Next = "WorkflowFailed"
          },
        ]
        End      = true
        Resource = module.cumulus.sf_sns_report_task_lambda_function_arn
        Retry = [
          {
            BackoffRate = 2
            ErrorEquals = [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
            ]
            IntervalSeconds = 2
            MaxAttempts     = 6
          },
        ]
        Type = "Task"
      }

      WorkflowFailed = {
        Cause = "Workflow failed"
        Type  = "Fail"
      }
    }
  })
}

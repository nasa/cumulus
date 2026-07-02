module "example_workflow" {
  source = "https://github.com/nasa/cumulus/releases/download/v21.0.1/terraform-aws-cumulus-workflow.zip" # Confirm which version We are on

  prefix          = var.PREFIX
  name            = "OPERAWorkflow"
  workflow_config = {
    sf_event_sqs_to_db_records_sqs_queue_arn: "arn:aws:sqs:${local.region}:${local.account_id}:${var.PREFIX}-sfEventSqsToDbRecordsInputQueue"
    sf_semaphore_down_lambda_function_arn: "arn:aws:lambda:${local.region}:${local.account_id}:function:${var.PREFIX}-sfSemaphoreDown"
    sqs_message_remover_lambda_function_arn: "arn:aws:lambda:${local.region}:${local.account_id}:function:${var.PREFIX}-sqsMessageRemover"
    state_machine_role_arn: "arn:aws:iam::${local.account_id}:role/${var.PREFIX}-steprole"
  }
  system_bucket   = local.system_bucket

  state_machine_definition = templatefile("./workflow.json", {
    "CnmToGranulesArn"        = module.cnm_to_granules_task.cnm_to_granules_task.task_arn
    "MoveGranulesArn"         = "arn:aws:lambda:${local.region}:${local.account_id}:function:${var.PREFIX}-MoveGranules"
    "ResponseArn"             = aws_lambda_function.response.arn
    "SyncGranuleArn"          = "arn:aws:lambda:${local.region}:${local.account_id}:function:${var.PREFIX}-SyncGranule"
  })
}

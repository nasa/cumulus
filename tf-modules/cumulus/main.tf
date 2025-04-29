terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  all_bucket_names       = [for k, v in var.buckets : v.name]
  protected_bucket_names = [for k, v in var.buckets : v.name if v.type == "protected"]
  public_bucket_names    = [for k, v in var.buckets : v.name if v.type == "public"]
  workflow_config = {
    sf_event_sqs_to_db_records_sqs_queue_arn         = module.archive.sf_event_sqs_to_db_records_sqs_queue_arn
    sf_semaphore_down_lambda_function_arn           = module.ingest.sf_semaphore_down_lambda_function_arn
    state_machine_role_arn                          = module.ingest.step_role_arn
    sqs_message_remover_lambda_function_arn         = module.ingest.sqs_message_remover_lambda_function_arn
  }
}

resource "aws_s3_bucket_object" "buckets_json" {
  bucket  = var.system_bucket
  key     = "${var.prefix}/buckets/buckets.json"
  content = jsonencode(var.buckets)
  etag    = md5(jsonencode(var.buckets))
}

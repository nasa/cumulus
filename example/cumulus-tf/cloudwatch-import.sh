# SCRIPT FOR IMPORTING CLOUDWATCH LOG GROUPS TO TERRAFORM STATE (CUMULUS TF), The module names may be different depending on the user
# check 'terraform state list' or 'terraform plan' in order to find out the module name for the respective log group and fix the script as needed.
# Additionally, all of the groups below may not apply to your deployment, please comment out log groups that are not causing 'ResourceAlreadyExistsException' or are
# not applicable to you.
#!/bin/zsh
set -e

echo "Importing Cloudwatch log groups for cumulus-tf, please open the script and change or comment out any import commands respective to your deployment \n"
echo -n "Enter the prefix used for your terraform deployment and press [ENTER]:"
read prefix
terraform init --reconfigure

terraform import module.cumulus.module.data_migration2.aws_cloudwatch_log_group.data_migration2 "/aws/lambda/$prefix-data-migration2"
terraform import module.cumulus.module.postgres_migration_async_operation.aws_cloudwatch_log_group.postgres-migration-async-operation "/aws/lambda/$prefix-postgres-migration-async-operation"
terraform import module.cumulus.module.postgres_migration_count_tool.aws_cloudwatch_log_group.postgres_migration_count_tool "/aws/lambda/$prefix-postgres-migration-count-tool"
terraform import module.cumulus.module.ingest.module.sqs_message_remover_lambda.aws_cloudwatch_log_group.sqs_message_remover "/aws/lambda/$prefix-sqsMessageRemover"
terraform import module.cumulus_distribution.aws_cloudwatch_log_group.api "/aws/lambda/$prefix-DistributionApiEndpoints"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.private_api "/aws/lambda/$prefix-PrivateApiLambda"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.custom_bootstrap "/aws/lambda/$prefix-CustomBootstrap"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.bulk_operation "/aws/lambda/$prefix-bulkOperation"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.clean_executions "/aws/lambda/$prefix-cleanExecutions"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.db_indexer "/aws/lambda/$prefix-dbIndexer"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.execute_migrations "/aws/lambda/$prefix-executeMigrations"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.index_from_database "/aws/lambda/$prefix-IndexFromDatabase"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.process_dead_letter_archive "/aws/lambda/$prefix-processDeadLetterArchive"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.create_reconciliation_report "/aws/lambda/$prefix-CreateReconciliationReport"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.sf_event_sqs_to_db_records "/aws/lambda/$prefix-sfEventSqsToDbRecords"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.write_db_dlq_records_to_s3 "/aws/lambda/$prefix-writeDbRecordsDLQtoS3"
terraform import module.cumulus.module.archive.aws_cloudwatch_log_group.start_async_operation "/aws/lambda/$prefix-StartAsyncOperation"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.add_missing_file_checksums_task "/aws/lambda/$prefix-AddMissingFileChecksums"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.fake_processing_task "/aws/lambda/$prefix-FakeProcessing"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.files_to_granules_task "/aws/lambda/$prefix-FilesToGranules"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.hello_world_task "/aws/lambda/$prefix-HelloWorld"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.fallback_consumer "/aws/lambda/$prefix-fallbackConsumer"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.kinesis_inbound_event_logger "/aws/lambda/$prefix-KinesisInboundEventLogger"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.kinesis_outbound_event_logger "/aws/lambda/$prefix-KinesisOutboundEventLogger"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.manual_consumer "/aws/lambda/$prefix-manualConsumer"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.message_consumer "/aws/lambda/$prefix-messageConsumer"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.schedule_sf "/aws/lambda/$prefix-ScheduleSF"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.sf_semaphore_down "/aws/lambda/$prefix-sfSemaphoreDown"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.sf_sqs_report_task "/aws/lambda/$prefix-SfSqsReport"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.sqs2sf "/aws/lambda/$prefix-sqs2sf"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.lzards_backup_task[0] "/aws/lambda/$prefix-LzardsBackup"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.move_granules_task "/aws/lambda/$prefix-MoveGranules"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.pdr_status_check_task "/aws/lambda/$prefix-PdrStatusCheck"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.queue_granules_task "/aws/lambda/$prefix-QueueGranules"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.update_granules_cmr_metadata_file_links_task "/aws/lambda/$prefix-UpdateGranulesCmrMetadataFileLinks"
terraform import module.cumulus.module.ingest.aws_cloudwatch_log_group.discover_granules_task "/aws/lambda/$prefix-DiscoverGranules"

echo "Successfully imported Cumulus log groups"

echo "Now importing s3 and TEA log groups"

terraform import module.s3_access_test_lambda.aws_cloudwatch_log_group.s3_acccess_test "/aws/lambda/$prefix-s3AccessTest"
terraform import module.tea_s3_credentials_endpoint_test.aws_cloudwatch_log_group.s3_credentials "/aws/lambda/$prefix-s3-credentials-endpoint"
terraform import module.tea_s3_credentials_endpoint_test.module.tea_map_cache.aws_cloudwatch_log_group.tea_cache "/aws/lambda/$prefix-TeaCache"

echo "Successfully imported s3 and TEA log groups"

echo "Now importing non-Cumulus maintained log groups, the module names may be different based on the user. Please check 'terraform plan' if unsure about the module definition before the following query"

terraform import aws_cloudwatch_log_group.cnm_response_task "/aws/lambda/$prefix-CnmResponse"
terraform import aws_cloudwatch_log_group.cnm_to_cma_task: "/aws/lambda/$prefix-CnmToCma"
terraform import aws_cloudwatch_log_group.async_operation_fail "/aws/lambda/$prefix-AsyncOperationFail"
terraform import aws_cloudwatch_log_group.async_operation_success "/aws/lambda/$prefix-AsyncOperationSuccess"
terraform import aws_cloudwatch_log_group.sns_s3_executions_test "/aws/lambda/$prefix-SnsS3ExecutionsTest"
terraform import aws_cloudwatch_log_group.sns_s3_granules_test "/aws/lambda/$prefix-SnsS3GranulesTest"
terraform import aws_cloudwatch_log_group.sns_s3_pdrs_test: "/aws/lambda/$prefix-SnsS3PdrsTest"
terraform import aws_cloudwatch_log_group.sns_s3_collections_test "/aws/lambda/$prefix-SnsS3CollectionsTest"
terraform import aws_cloudwatch_log_group.ftpPopulateTestLambda "/aws/lambda/$prefix-populateTestLambda"
terraform import aws_cloudwatch_log_group.lzards_api_client_test "/aws/lambda/$prefix-LzardsApiClientTest"
terraform import aws_cloudwatch_log_group.python_reference_task "/aws/lambda/$prefix-PythonReferenceTask"

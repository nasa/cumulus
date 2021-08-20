const isNil = require('lodash/isNil');
const { DynamoDB } = require('aws-sdk');

const {
  ExecutionPgModel,
} = require('@cumulus/db');
const {
  indexExecution,
} = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
  getMessageCumulusVersion,
  getMessageExecutionOriginalPayload,
  getMessageExecutionFinalPayload,
  generateExecutionApiRecordFromMessage,
} = require('@cumulus/message/Executions');
const {
  getMetaStatus,
  getMessageWorkflowTasks,
  getMessageWorkflowName,
  getMessageWorkflowStartTime,
  getMessageWorkflowStopTime,
  getWorkflowDuration,
} = require('@cumulus/message/workflows');
const { parseException } = require('@cumulus/message/utils');
const { publishSnsMessage } = require('@cumulus/aws-client/SNS');

const { removeNilProperties } = require('@cumulus/common/util');
const Logger = require('@cumulus/logger');

const Execution = require('../../models/executions');

const logger = new Logger({ sender: '@cumulus/sfEventSqsToDbRecords/write-execution' });

const shouldWriteExecutionToPostgres = ({
  messageCollectionNameVersion,
  collectionCumulusId,
  messageAsyncOperationId,
  asyncOperationCumulusId,
  messageParentExecutionArn,
  parentExecutionCumulusId,
}) => {
  const noMessageCollectionOrExistsInPostgres = isNil(messageCollectionNameVersion)
    || !isNil(collectionCumulusId);
  const noMessageAsyncOperationOrExistsInPostgres = isNil(messageAsyncOperationId)
    || !isNil(asyncOperationCumulusId);
  const noMessageParentExecutionOrExistsInPostgres = isNil(messageParentExecutionArn)
    || !isNil(parentExecutionCumulusId);

  return noMessageCollectionOrExistsInPostgres
    && noMessageAsyncOperationOrExistsInPostgres
    && noMessageParentExecutionOrExistsInPostgres;
};

const buildExecutionRecord = ({
  cumulusMessage,
  asyncOperationCumulusId,
  collectionCumulusId,
  parentExecutionCumulusId,
  now = new Date(),
  updatedAt = Date.now(),
}) => {
  const arn = getMessageExecutionArn(cumulusMessage);
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const workflowStopTime = getMessageWorkflowStopTime(cumulusMessage);

  return removeNilProperties({
    arn,
    status: getMetaStatus(cumulusMessage),
    url: getExecutionUrlFromArn(arn),
    cumulus_version: getMessageCumulusVersion(cumulusMessage),
    tasks: getMessageWorkflowTasks(cumulusMessage),
    workflow_name: getMessageWorkflowName(cumulusMessage),
    created_at: workflowStartTime ? new Date(workflowStartTime) : undefined,
    timestamp: now,
    updated_at: new Date(updatedAt),
    error: parseException(cumulusMessage.exception),
    original_payload: getMessageExecutionOriginalPayload(cumulusMessage),
    final_payload: getMessageExecutionFinalPayload(cumulusMessage),
    duration: getWorkflowDuration(workflowStartTime, workflowStopTime),
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: parentExecutionCumulusId,
  });
};

const writeExecutionViaTransaction = async ({
  cumulusMessage,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  trx,
  executionPgModel = new ExecutionPgModel(),
  updatedAt,
}) => {
  const executionRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    updatedAt,
  });
  logger.info(`About to write execution ${executionRecord.arn} to PostgreSQL`);
  const upsertResponse = await executionPgModel.upsert(trx, executionRecord);
  logger.info(`Successfully wrote execution ${executionRecord.arn} to PostgreSQL with cumulus_id ${upsertResponse[0]}`);
  return upsertResponse;
};

const writeExecutionToDynamoAndES = async (params) => {
  const {
    executionApiRecord,
    executionModel,
    esClient = await Search.es(),
  } = params;
  try {
    await executionModel.storeExecution(executionApiRecord);
    await indexExecution(esClient, executionApiRecord, process.env.ES_INDEX);
    return executionApiRecord;
  } catch (error) {
    // On error, delete the Dynamo record to ensure that all systems
    // stay in sync
    await executionModel.delete({ arn: executionApiRecord.arn });
    throw error;
  }
};

const publishExecutionSnsMessage = async (record) => {
  const topicArn = process.env.execution_sns_topic_arn;
  const message = DynamoDB.Converter.marshall(record);
  logger.info(`About to publish SNS message ${JSON.stringify(message)} for execution to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, message);
};

const writeExecution = async ({
  cumulusMessage,
  knex,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  executionModel = new Execution(),
  updatedAt = Date.now(),
  esClient,
}) => {
  const executionApiRecord = generateExecutionApiRecordFromMessage(cumulusMessage, updatedAt);
  await knex.transaction(async (trx) => {
    const [executionCumulusId] = await writeExecutionViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      asyncOperationCumulusId,
      parentExecutionCumulusId,
      trx,
      updatedAt,
    });
    await writeExecutionToDynamoAndES({
      executionApiRecord,
      executionModel,
      esClient,
    });
    await publishExecutionSnsMessage(executionApiRecord);
    return executionCumulusId;
  });
};

module.exports = {
  buildExecutionRecord,
  publishExecutionSnsMessage,
  shouldWriteExecutionToPostgres,
  writeExecutionToDynamoAndES,
  writeExecutionViaTransaction,
  writeExecution,
};

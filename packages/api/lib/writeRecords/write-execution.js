const isNil = require('lodash/isNil');

const {
  ExecutionPgModel,
  translateApiExecutionToPostgresExecution,
} = require('@cumulus/db');
const {
  upsertExecution,
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

const { removeNilProperties } = require('@cumulus/common/util');
const Logger = require('@cumulus/logger');

const Execution = require('../../models/executions');

const logger = new Logger({ sender: '@cumulus/api/lib/writeRecords/write-execution' });

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

const writeExecutionToDynamoAndES = async (params) => {
  const {
    cumulusMessage,
    executionModel,
    updatedAt = Date.now(),
    esClient = await Search.es(),
  } = params;
  const executionApiRecord = generateExecutionApiRecordFromMessage(cumulusMessage, updatedAt);
  try {
    await executionModel.storeExecutionRecord(executionApiRecord);
    await upsertExecution({
      esClient,
      updates: executionApiRecord,
      index: process.env.ES_INDEX,
    });
  } catch (error) {
    logger.info(`Writes to DynamoDB/Elasticsearch failed, rolling back all writes for execution ${executionApiRecord.arn}`);
    // On error, delete the Dynamo record to ensure that all systems
    // stay in sync
    await executionModel.delete({ arn: executionApiRecord.arn });
    throw error;
  }
};

const _writeExecutionRecord = ({
  postgresRecord,
  cumulusMessage,
  knex,
  executionModel = new Execution(),
  executionPgModel = new ExecutionPgModel(),
  updatedAt = Date.now(),
  esClient,
}) => knex.transaction(async (trx) => {
  logger.info(`About to write execution ${postgresRecord.arn} to PostgreSQL`);
  const [executionCumulusId] = await executionPgModel.upsert(trx, postgresRecord);
  logger.info(`Successfully wrote execution ${postgresRecord.arn} to PostgreSQL with cumulus_id ${executionCumulusId}`);
  await writeExecutionToDynamoAndES({
    cumulusMessage,
    updatedAt,
    executionModel,
    esClient,
  });
  // await executionModel.storeExecutionRecord(dynamoRecord);
  return executionCumulusId;
});

const writeExecutionRecordFromMessage = ({
  cumulusMessage,
  knex,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  executionModel = new Execution(),
  updatedAt = Date.now(),
}) => {
  const postgresRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    updatedAt,
  });
  return _writeExecutionRecord(
    {
      postgresRecord,
      cumulusMessage,
      knex,
      executionModel,
    }
  );
};

const writeExecutionRecordFromApi = async ({
  record: dynamoRecord,
  knex,
  executionModel = new Execution(),
}) => {
  const postgresRecord = await translateApiExecutionToPostgresExecution(dynamoRecord, knex);
  return _writeExecutionRecord({ dynamoRecord, postgresRecord, knex, executionModel });
};

module.exports = {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecutionToDynamoAndES,
  writeExecutionRecordFromMessage,
  writeExecutionRecordFromApi,
};

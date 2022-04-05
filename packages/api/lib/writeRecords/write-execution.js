const isNil = require('lodash/isNil');

const {
  createRejectableTransaction,
  ExecutionPgModel,
  translateApiExecutionToPostgresExecution,
  translatePostgresExecutionToApiExecution,
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

const { publishExecutionSnsMessage } = require('../publishSnsMessageUtils');
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
    dynamoRecord,
    executionModel,
    esClient = await Search.es(),
  } = params;
  try {
    await executionModel.storeExecutionRecord(dynamoRecord);
    await upsertExecution({
      esClient,
      updates: dynamoRecord,
      index: process.env.ES_INDEX,
    });
  } catch (error) {
    logger.info(`Writes to DynamoDB/Elasticsearch failed, rolling back all writes for execution ${dynamoRecord.arn}`);
    // On error, delete the Dynamo record to ensure that all systems
    // stay in sync
    await executionModel.delete({ arn: dynamoRecord.arn });
    throw error;
  }
};

/**
 * Write execution record to databases
 *
 * @param {Object} params
 * @param {Object} params.dynamoRecord - Execution DynamoDB record to be written
 * @param {Object} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {Object} params.knex - Knex client
 * @param {Object} [params.executionModel] - DynamoDB execution model
 * @param {Object} [params.executionPgModel] - PostgreSQL execution model
 * @param {number} [params.updatedAt] - updatedAt timestamp to use when writing records
 * @param {Object} [params.esClient] - Elasticsearch client
 * @returns {Promise<Object>} - PostgreSQL execution record that was written to the database
 */
const _writeExecutionRecord = ({
  dynamoRecord,
  postgresRecord,
  knex,
  executionModel = new Execution(),
  executionPgModel = new ExecutionPgModel(),
  updatedAt = Date.now(),
  esClient,
}) => createRejectableTransaction(knex, async (trx) => {
  logger.info(`About to write execution ${postgresRecord.arn} to PostgreSQL`);
  const [executionPgRecord] = await executionPgModel.upsert(trx, postgresRecord);
  logger.info(`Successfully wrote execution ${postgresRecord.arn} to PostgreSQL with cumulus_id ${executionPgRecord.cumulus_id}`);
  await writeExecutionToDynamoAndES({
    dynamoRecord,
    executionModel,
    updatedAt,
    esClient,
  });
  return executionPgRecord;
});

/**
 * Write execution record to databases and publish SNS message
 *
 * @param {Object} params
 * @param {Object} params.dynamoRecord - Execution DynamoDB record to be written
 * @param {Object} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {Object} params.knex - Knex client
 * @param {Object} [params.executionModel] - DynamoDB execution model
 * @param {Object} [params.executionPgModel] - PostgreSQL execution model
 * @param {number} [params.updatedAt] - updatedAt timestamp to use when writing records
 * @param {Object} [params.esClient] - Elasticsearch client
 * @returns {Promise<Object>} - PostgreSQL execution record that was written to the database
 */
const _writeExecutionAndPublishSnsMessage = async ({
  dynamoRecord,
  postgresRecord,
  knex,
  executionModel,
  executionPgModel,
  updatedAt,
  esClient,
}) => {
  const writeExecutionResponse = await _writeExecutionRecord(
    {
      dynamoRecord,
      postgresRecord,
      knex,
      executionModel,
      esClient,
      executionPgModel,
      updatedAt,
    }
  );
  const translatedExecution = await translatePostgresExecutionToApiExecution(
    writeExecutionResponse,
    knex
  );
  await publishExecutionSnsMessage(translatedExecution);
  return writeExecutionResponse;
};

const writeExecutionRecordFromMessage = async ({
  cumulusMessage,
  knex,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  executionModel = new Execution(),
  updatedAt = Date.now(),
  esClient,
}) => {
  const postgresRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    updatedAt,
  });
  const executionApiRecord = generateExecutionApiRecordFromMessage(cumulusMessage, updatedAt);
  const writeExecutionResponse = await _writeExecutionAndPublishSnsMessage({
    dynamoRecord: executionApiRecord,
    postgresRecord,
    knex,
    executionModel,
    esClient,
  });
  return writeExecutionResponse.cumulus_id;
};

const writeExecutionRecordFromApi = async ({
  record: dynamoRecord,
  knex,
  executionModel = new Execution(),
}) => {
  const postgresRecord = await translateApiExecutionToPostgresExecution(dynamoRecord, knex);
  return await _writeExecutionAndPublishSnsMessage({
    dynamoRecord,
    postgresRecord,
    knex,
    executionModel,
  });
};

module.exports = {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecutionToDynamoAndES,
  writeExecutionRecordFromMessage,
  writeExecutionRecordFromApi,
};

const isNil = require('lodash/isNil');
const isUndefined = require('lodash/isUndefined');
const omitBy = require('lodash/omitBy');

const {
  ExecutionPgModel,
  translateApiExecutionToPostgresExecutionWithoutNilsRemoved,
  translatePostgresExecutionToApiExecution,
} = require('@cumulus/db');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
  getMessageCumulusVersion,
  getMessageExecutionOriginalPayload,
  getMessageExecutionFinalPayload,
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

const Logger = require('@cumulus/logger');

const { publishExecutionSnsMessage } = require('../publishSnsMessageUtils');

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
  updatedAt = Date.now(),
}) => {
  const arn = getMessageExecutionArn(cumulusMessage);
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const workflowStopTime = getMessageWorkflowStopTime(cumulusMessage);

  const record = {
    arn,
    status: getMetaStatus(cumulusMessage),
    url: getExecutionUrlFromArn(arn),
    cumulus_version: getMessageCumulusVersion(cumulusMessage),
    tasks: getMessageWorkflowTasks(cumulusMessage),
    workflow_name: getMessageWorkflowName(cumulusMessage),
    created_at: workflowStartTime ? new Date(workflowStartTime) : undefined,
    timestamp: new Date(updatedAt),
    updated_at: new Date(updatedAt),
    error: parseException(cumulusMessage.exception),
    original_payload: getMessageExecutionOriginalPayload(cumulusMessage),
    final_payload: getMessageExecutionFinalPayload(cumulusMessage),
    duration: getWorkflowDuration(workflowStartTime, workflowStopTime),
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: parentExecutionCumulusId,
  };
  return omitBy(record, isUndefined);
};

/**
 * Write execution record to databases
 *
 * @param {object} params
 * @param {object} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {object} params.knex - Knex client
 * @param {object} [params.executionPgModel] - PostgreSQL execution model
 * @param {object} [params.writeConstraints] - Boolean flag to set if record write constraints apply
 * @returns {Promise<object>} - PostgreSQL execution record that was written to the database
 */
const _writeExecutionRecord = async ({
  postgresRecord,
  knex,
  executionPgModel = new ExecutionPgModel(),
  writeConstraints = true,
}) => {
  logger.info(`About to write execution ${postgresRecord.arn} to PostgreSQL`);
  const [executionPgRecord] = await executionPgModel.upsert(knex, postgresRecord, writeConstraints);
  logger.info(`Successfully wrote execution ${postgresRecord.arn} to PostgreSQL with cumulus_id ${executionPgRecord.cumulus_id}`);
  return executionPgRecord;
};

/**
 * Write execution record to databases and publish SNS message
 *
 * @param {object} params
 * @param {object} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {object} params.knex - Knex client
 * @param {object} [params.executionPgModel] - PostgreSQL execution model
 * @param {object} [params.writeConstraints] - Boolean flag to set if record write constraints apply
 * @returns {Promise<object>} - PostgreSQL execution record that was written to the database
 */
const _writeExecutionAndPublishSnsMessage = async ({
  postgresRecord,
  knex,
  executionPgModel,
  writeConstraints = true,
}) => {
  const writeExecutionResponse = await _writeExecutionRecord(
    {
      postgresRecord,
      knex,
      executionPgModel,
      writeConstraints,
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
  updatedAt = Date.now(),
}) => {
  const postgresRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    updatedAt,
  });
  const writeExecutionResponse = await _writeExecutionAndPublishSnsMessage({
    postgresRecord: omitBy(postgresRecord, isUndefined),
    knex,
  });
  return writeExecutionResponse.cumulus_id;
};

const writeExecutionRecordFromApi = async ({
  record: apiRecord,
  knex,
}) => {
  const postgresRecord = await
  translateApiExecutionToPostgresExecutionWithoutNilsRemoved(apiRecord, knex);
  return await _writeExecutionAndPublishSnsMessage({
    postgresRecord: omitBy(postgresRecord, isUndefined),
    knex,
    writeConstraints: false,
  });
};

module.exports = {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecutionRecordFromMessage,
  writeExecutionRecordFromApi,
};

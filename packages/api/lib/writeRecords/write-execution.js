// @ts-check

const isNil = require('lodash/isNil');
const isUndefined = require('lodash/isUndefined');
const omitBy = require('lodash/omitBy');

const {
  ExecutionPgModel,
  CollectionPgModel,
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

/**
 * @typedef { import('knex').Knex } Knex
 * @typedef { import('knex').Knex.Transaction } KnexTransaction
 * @typedef { import('@cumulus/types').ApiExecution } ApiExecution
 * @typedef { import('@cumulus/types').MetricsExecution } MetricsExecution
 * @typedef { import('@cumulus/types/message').CumulusMessage} CumulusMessage
 * @typedef { import('@cumulus/db').PostgresExecution } PostgresExecution
 * @typedef { import('@cumulus/db').PostgresExecutionRecord } PostgresExecutionRecord
 * @typedef { import('@cumulus/db').ExecutionPgModel } ExecutionPgModelType
*/

const logger = new Logger({ sender: '@cumulus/api/lib/writeRecords/write-execution' });

/**
 * Determines whether an execution record should be written to Postgres.
 *
 * @param {object} params - Input parameters.
 * @param {string} [params.messageCollectionNameVersion] - The collection name-version
 * @param {number} [params.collectionCumulusId] - The collection identifier
 * @param {number} [params.messageAsyncOperationId] - Async operation ID
 * @param {number} [params.asyncOperationCumulusId] - Async operation identifier
 * @param {string} [params.messageParentExecutionArn] - Parent execution ARN
 * @param {number} [params.parentExecutionCumulusId] - Parent execution identifier
 * @returns {boolean} - Returns `true` if the execution record should be written to Postgres
 */
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

/**
 * Builds a normalized execution object from a Cumulus message and related metadata.
 *
 * @param {object} params - Input parameters.
 * @param {CumulusMessage} params.cumulusMessage - The raw Cumulus message containing
 *   execution details.
 * @param {number} [params.asyncOperationCumulusId] - Identifier for the associated async operation.
 * @param {number} [params.collectionCumulusId] - Identifier for the associated collection.
 * @param {number} [params.parentExecutionCumulusId] - Identifier for the parent execution
 * @param {Date} [params.parentExecutionCreatedAt] - Creation timestamp of the parent execution.
 * @param {number} [params.updatedAt=Date.now()] - Timestamp (in ms) used for `timestamp`
 *   and `updated_at`.
 * @throws {Error} Throws if only one of `parentExecutionCumulusId` or `parentExecutionCreatedAt`
 *   is provided.
 * @returns {PostgresExecution} - PG Execution
 */
const buildExecutionRecord = ({
  cumulusMessage,
  asyncOperationCumulusId,
  collectionCumulusId,
  parentExecutionCumulusId,
  parentExecutionCreatedAt,
  updatedAt = Date.now(),
}) => {
  const arn = getMessageExecutionArn(cumulusMessage);
  if (!arn) {
    throw new Error('Execution ARN is missing from the Cumulus message');
  }
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const workflowStopTime = getMessageWorkflowStopTime(cumulusMessage);

  if (isNil(parentExecutionCumulusId) !== isNil(parentExecutionCreatedAt)) {
    throw new Error('parentExecutionCumulusId and parentExecutionCreatedAt must either both be set or both be unset');
  }

  const record = {
    arn,
    status: getMetaStatus(cumulusMessage),
    url: arn ? getExecutionUrlFromArn(arn) : undefined,
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
    parent_created_at: parentExecutionCreatedAt,
  };
  // Re-add arn to satisfy TS type checking (omitBy cannot guarantee required fields are preserved)
  return { ...omitBy(record, isUndefined), arn };
};

/**
 * Write execution record to databases
 *
 * @param {object} params
 * @param {PostgresExecution} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {Knex} params.knex - Knex client
 * @param {ExecutionPgModelType} [params.executionPgModel] - PostgreSQL execution model
 * @param {boolean} [params.writeConstraints] - Boolean flag to set if record write constraints
 *   apply
 * @returns {Promise<PostgresExecutionRecord>} - PostgreSQL execution record that was written
 *   to the database
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
 * @param {PostgresExecution} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {Knex} params.knex - Knex client
 * @param {ExecutionPgModelType} [params.executionPgModel] - PostgreSQL execution model
 * @param {string | null} params.cmrProvider - cmr provider inherited from calling function.
 *   will be determined if left null
 * @param {boolean} [params.writeConstraints] - Boolean flag to set if record write constraints
 *   apply
 * @returns {Promise<PostgresExecutionRecord>} - PostgreSQL execution record that was written
 *   to the database
 */
const _writeExecutionAndPublishSnsMessage = async ({
  postgresRecord,
  knex,
  executionPgModel,
  cmrProvider = null,
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
  let finalCmrProvider;
  const { collection_cumulus_id: collectionCumulusId } = postgresRecord;
  if (cmrProvider) {
    finalCmrProvider = cmrProvider;
  } else if (collectionCumulusId) {
    const collectionPgModel = new CollectionPgModel();
    finalCmrProvider = await collectionPgModel.getCmrProvider(
      knex,
      collectionCumulusId
    );
  }
  const metricsExecution = {
    cmrProvider: finalCmrProvider || '',
    ...translatedExecution,
  };

  await publishExecutionSnsMessage(metricsExecution);
  return writeExecutionResponse;
};

/**
 * Write an execution record from a Cumulus Message to the database, then publish
 * a corresponding SNS message
 *
 * @param {object} params
 * @param {CumulusMessage} params.cumulusMessage - The Cumulus message
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {number} [params.collectionCumulusId] - Identifier for the associated collection
 * @param {number} [params.asyncOperationCumulusId] - Identifier for the associated async operation
 * @param {number} [params.parentExecutionCumulusId] - Identifier for the parent execution
 * @param {Date} [params.parentExecutionCreatedAt] - Creation timestamp of the parent execution
 * @param {string | null} params.cmrProvider - cmrProvider
 * @param {number} [params.updatedAt=Date.now()] - Timestamp (in ms) used for record updateAt field
 * @returns {Promise<PostgresExecutionRecord>} - write message response
 */
const writeExecutionRecordFromMessage = async ({
  cumulusMessage,
  knex,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  parentExecutionCreatedAt,
  cmrProvider = null,
  updatedAt = Date.now(),
}) => {
  const postgresRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    parentExecutionCreatedAt,
    updatedAt,
  });
  const writeExecutionResponse = await _writeExecutionAndPublishSnsMessage({
    // Re-add arn to satisfy TS type checking
    postgresRecord: { ...omitBy(postgresRecord, isUndefined), arn: postgresRecord.arn },
    cmrProvider,
    knex,
  });
  return writeExecutionResponse;
};

/**
 * Write an execution record to the database from api record
 *
 * @param {object} params
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {ApiExecution} params.record- The execution api record
 * @returns {Promise<PostgresExecutionRecord>} - write message response
 */
const writeExecutionRecordFromApi = async ({
  record: apiRecord,
  knex,
}) => {
  const postgresRecord = await
  translateApiExecutionToPostgresExecutionWithoutNilsRemoved(apiRecord, knex);
  return await _writeExecutionAndPublishSnsMessage({
    // Re-add arn to satisfy TS type checking
    postgresRecord: { ...omitBy(postgresRecord, isUndefined), arn: postgresRecord.arn },
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

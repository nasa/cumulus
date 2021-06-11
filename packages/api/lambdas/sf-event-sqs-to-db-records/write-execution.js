const isNil = require('lodash/isNil');

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

const { removeNilProperties } = require('@cumulus/common/util');

const Execution = require('../../models/executions');

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
  return await executionPgModel.upsert(trx, executionRecord);
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
    await executionModel.storeExecution(executionApiRecord);
    await indexExecution(esClient, executionApiRecord, process.env.ES_INDEX);
  } catch (error) {
    // On error, delete the Dynamo record to ensure that all systems
    // stay in sync
    await executionModel.delete({ arn: executionApiRecord.arn });
    throw error;
  }
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
}) =>
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
      cumulusMessage,
      updatedAt,
      executionModel,
      esClient,
    });
    return executionCumulusId;
  });

module.exports = {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecutionToDynamoAndES,
  writeExecutionViaTransaction,
  writeExecution,
};

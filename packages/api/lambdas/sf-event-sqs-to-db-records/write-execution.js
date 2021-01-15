const isNil = require('lodash/isNil');

const {
  ExecutionPgModel,
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

const { parseException } = require('../../lib/utils');
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
}) => {
  const arn = getMessageExecutionArn(cumulusMessage);
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const workflowStopTime = getMessageWorkflowStopTime(cumulusMessage);

  return {
    arn,
    status: getMetaStatus(cumulusMessage),
    url: getExecutionUrlFromArn(arn),
    cumulus_version: getMessageCumulusVersion(cumulusMessage),
    tasks: getMessageWorkflowTasks(cumulusMessage),
    workflow_name: getMessageWorkflowName(cumulusMessage),
    created_at: workflowStartTime ? new Date(workflowStartTime) : undefined,
    timestamp: now,
    updated_at: now,
    error: parseException(cumulusMessage.exception),
    original_payload: getMessageExecutionOriginalPayload(cumulusMessage),
    final_payload: getMessageExecutionFinalPayload(cumulusMessage),
    duration: getWorkflowDuration(workflowStartTime, workflowStopTime),
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: parentExecutionCumulusId,
  };
};

const writeExecutionViaTransaction = async ({
  cumulusMessage,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  trx,
  executionPgModel = new ExecutionPgModel(),
}) => {
  const executionRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
  });
  return executionPgModel.upsert(trx, executionRecord);
};

const writeExecution = async ({
  cumulusMessage,
  knex,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  executionModel = new Execution(),
}) =>
  knex.transaction(async (trx) => {
    const [executionCumulusId] = await writeExecutionViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      asyncOperationCumulusId,
      parentExecutionCumulusId,
      trx,
    });
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
    return executionCumulusId;
  });

module.exports = {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecutionViaTransaction,
  writeExecution,
};

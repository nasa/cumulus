const isNil = require('lodash/isNil');

const {
  tableNames,
} = require('@cumulus/db');
const { UnmetRequirementsError } = require('@cumulus/errors');
const {
  getMessageAsyncOperationId,
} = require('@cumulus/message/AsyncOperations');
const {
  getMessageExecutionArn,
  getMessageExecutionParentArn,
  getExecutionUrlFromArn,
  getMessageCumulusVersion,
  getMessageWorkflowTasks,
  getMessageWorkflowName,
  getMessageWorkflowStartTime,
  getMessageWorkflowStopTime,
  getMessageExecutionOriginalPayload,
  getMessageExecutionFinalPayload,
} = require('@cumulus/message/Executions');
const {
  getMetaStatus,
} = require('@cumulus/message/workflows');

const { parseException } = require('../../lib/utils');
const Execution = require('../../models/executions');

const {
  isPostRDSDeploymentExecution,
  getAsyncOperationCumulusId,
  getParentExecutionCumulusId,
} = require('./utils');

const getWriteExecutionRequirements = async ({
  cumulusMessage,
  messageCollectionNameVersion,
  collectionCumulusId,
  knex,
}) => {
  const isExecutionPostDeployment = isPostRDSDeploymentExecution(cumulusMessage);
  if (!isExecutionPostDeployment) {
    throw new UnmetRequirementsError('Workflow message was not started before RDS deployment');
  }

  if (!isNil(messageCollectionNameVersion) && isNil(collectionCumulusId)) {
    throw new UnmetRequirementsError(
      `Collection ${JSON.stringify(messageCollectionNameVersion)} found on message, but not in database`
    );
  }

  const messageAsyncOperationId = getMessageAsyncOperationId(cumulusMessage);
  const asyncOperationCumulusId = await getAsyncOperationCumulusId(
    messageAsyncOperationId,
    knex
  );
  if (!isNil(messageAsyncOperationId) && isNil(asyncOperationCumulusId)) {
    throw new UnmetRequirementsError(`Async operation id ${messageAsyncOperationId} found in message, but not in database`);
  }

  const messageParentExecutionArn = getMessageExecutionParentArn(cumulusMessage);
  const parentExecutionCumulusId = await getParentExecutionCumulusId(
    messageParentExecutionArn,
    knex
  );
  if (!isNil(messageParentExecutionArn) && isNil(parentExecutionCumulusId)) {
    throw new UnmetRequirementsError(`Parent execution arn ${messageParentExecutionArn} found in message, but not in database`);
  }

  return {
    asyncOperationCumulusId,
    parentExecutionCumulusId,
  };
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
    duration: isNil(workflowStopTime) ? 0 : (workflowStopTime - workflowStartTime) / 1000,
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: parentExecutionCumulusId,
  };
};

/**
 * Special upsert logic for updating a "running" execution. Only
 * certain fields should be updated if the right is updating a
 * "running" execution.
 *
 * @param {Object} params
 * @param {unknown} params.trx - A Knex transaction
 * @param {Object} params.executionRecord - An execution record
 *
 * @returns {Promise}
 */
const writeRunningExecutionViaTransaction = async ({
  trx,
  executionRecord,
}) =>
  trx(tableNames.executions)
    .insert(executionRecord)
    .onConflict('arn')
    .merge({
      created_at: executionRecord.created_at,
      updated_at: executionRecord.updated_at,
      timestamp: executionRecord.timestamp,
      original_payload: executionRecord.original_payload,
    })
    .returning('cumulus_id');

const writeExecutionViaTransaction = async ({
  cumulusMessage,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  trx,
}) => {
  const executionRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
  });
  // Special upsert logic for updating a "running" execution
  if (executionRecord.status === 'running') {
    return writeRunningExecutionViaTransaction({
      trx,
      executionRecord,
    });
  }
  // Otherwise update all fields on conflict
  return trx(tableNames.executions)
    .insert(executionRecord)
    .onConflict('arn')
    .merge()
    .returning('cumulus_id');
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
    // eslint-disable-next-line camelcase
    const [cumulus_id] = await writeExecutionViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      asyncOperationCumulusId,
      parentExecutionCumulusId,
      trx,
    });
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
    // eslint-disable-next-line camelcase
    return cumulus_id;
  });

module.exports = {
  buildExecutionRecord,
  getWriteExecutionRequirements,
  writeRunningExecutionViaTransaction,
  writeExecutionViaTransaction,
  writeExecution,
};

const isNil = require('lodash/isNil');

const log = require('@cumulus/common/log');
const {
  tableNames,
} = require('@cumulus/db');
const {
  getMessageExecutionArn,
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
  hasNoAsyncOpOrExists,
  hasNoParentExecutionOrExists,
} = require('./utils');

const shouldWriteExecutionToRDS = async (
  cumulusMessage,
  collectionCumulusId,
  knex
) => {
  const isExecutionPostDeployment = isPostRDSDeploymentExecution(cumulusMessage);
  if (!isExecutionPostDeployment) return false;

  try {
    if (!collectionCumulusId) return false;

    const results = await Promise.all([
      hasNoParentExecutionOrExists(cumulusMessage, knex),
      hasNoAsyncOpOrExists(cumulusMessage, knex),
    ]);
    return results.every((result) => result === true);
  } catch (error) {
    log.error(error);
    return false;
  }
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

const writeExecutionViaTransaction = async ({
  cumulusMessage,
  collectionCumulusId,
  trx,
}) => {
  const executionRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
  });
  return trx(tableNames.executions)
    .insert(executionRecord)
    .returning('cumulus_id');
};

const writeExecution = async ({
  cumulusMessage,
  knex,
  collectionCumulusId,
  executionModel = new Execution(),
}) =>
  knex.transaction(async (trx) => {
    // eslint-disable-next-line camelcase
    const [cumulus_id] = await writeExecutionViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      trx,
    });
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
    // eslint-disable-next-line camelcase
    return cumulus_id;
  });

module.exports = {
  buildExecutionRecord,
  shouldWriteExecutionToRDS,
  writeExecutionViaTransaction,
  writeExecution,
};

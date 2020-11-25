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

const writeExecutionViaTransaction = async ({ cumulusMessage, trx }) => {
  const arn = getMessageExecutionArn(cumulusMessage);
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const workflowStopTime = getMessageWorkflowStopTime(cumulusMessage);

  return trx(tableNames.executions)
    .insert({
      arn,
      status: getMetaStatus(cumulusMessage),
      url: getExecutionUrlFromArn(arn),
      cumulus_version: getMessageCumulusVersion(cumulusMessage),
      tasks: getMessageWorkflowTasks(cumulusMessage),
      workflow_name: getMessageWorkflowName(cumulusMessage),
      created_at: workflowStartTime ? new Date(workflowStartTime) : undefined,
      timestamp: new Date(),
      updated_at: new Date(),
      original_payload: getMessageExecutionOriginalPayload(cumulusMessage),
      final_payload: getMessageExecutionFinalPayload(cumulusMessage),
      duration: isNil(workflowStopTime) ? 0 : (workflowStopTime - workflowStartTime) / 1000,
      // collection_cumulus_id: collectionCumulusId,
    })
    .returning('cumulus_id');
};

const writeExecution = async ({
  cumulusMessage,
  knex,
  executionModel = new Execution(),
}) =>
  knex.transaction(async (trx) => {
    // eslint-disable-next-line camelcase
    const [cumulus_id] = await writeExecutionViaTransaction({ cumulusMessage, trx });
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
    // eslint-disable-next-line camelcase
    return cumulus_id;
  });

module.exports = {
  shouldWriteExecutionToRDS,
  writeExecutionViaTransaction,
  writeExecution,
};

const log = require('@cumulus/common/log');
const {
  tableNames,
} = require('@cumulus/db');
const {
  getMessageExecutionArn,
  getMessageCumulusVersion,
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

const writeExecutionViaTransaction = async ({ cumulusMessage, trx }) =>
  trx(tableNames.executions)
    .insert({
      arn: getMessageExecutionArn(cumulusMessage),
      cumulus_version: getMessageCumulusVersion(cumulusMessage),
      status: getMetaStatus(cumulusMessage),
    })
    .returning('cumulus_id');

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

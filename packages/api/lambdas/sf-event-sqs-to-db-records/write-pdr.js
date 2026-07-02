'use strict';

const {
  createRejectableTransaction,
  CollectionPgModel,
  PdrPgModel,
  translatePostgresPdrToApiPdr,
} = require('@cumulus/db');
const {
  getMessagePdrName,
  messageHasPdr,
  getMessagePdrStats,
  getMessagePdrPANSent,
  getMessagePdrPANMessage,
  getPdrPercentCompletion,
} = require('@cumulus/message/PDRs');
const {
  getMetaStatus,
  getMessageWorkflowStartTime,
  getWorkflowDuration,
} = require('@cumulus/message/workflows');
const Logger = require('@cumulus/logger');
const { publishPdrSnsMessage } = require('../../lib/publishSnsMessageUtils');

const logger = new Logger({ sender: '@cumulus/sfEventSqsToDbRecords/write-pdr' });

const generatePdrRecord = ({
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  executionCreatedAt,
  now = Date.now(),
  updatedAt = Date.now(),
}) => {
  const stats = getMessagePdrStats(cumulusMessage);
  const progress = getPdrPercentCompletion(stats);
  const timestamp = now;
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);

  return {
    name: getMessagePdrName(cumulusMessage),
    status: getMetaStatus(cumulusMessage),
    pan_sent: getMessagePdrPANSent(cumulusMessage),
    pan_message: getMessagePdrPANMessage(cumulusMessage),
    stats,
    progress,
    execution_cumulus_id: executionCumulusId,
    execution_created_at: executionCreatedAt,
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: providerCumulusId,
    created_at: new Date(workflowStartTime),
    updated_at: new Date(updatedAt),
    timestamp: new Date(timestamp),
    duration: getWorkflowDuration(workflowStartTime, timestamp),
  };
};

const writePdrViaTransaction = async ({
  cumulusMessage,
  trx,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  executionCreatedAt,
  pdrPgModel = new PdrPgModel(),
  updatedAt,
}) => {
  const pdrRecord = generatePdrRecord({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    executionCreatedAt,
    updatedAt,
  });

  logger.info(`About to write PDR ${pdrRecord.name} to PostgreSQL`);

  const queryResult = await pdrPgModel.upsert(trx, pdrRecord);

  // If the WHERE clause of the upsert query is not met, then the
  // result from the query is empty so no cumulus_id will be returned.
  // But this function always needs to return a cumulus_id for the PDR
  // since it is used for writing granules
  const pdr = queryResult[0] || await pdrPgModel.get(trx, { name: pdrRecord.name });

  logger.info(`Successfully upserted PDR ${pdrRecord.name} to PostgreSQL with cumulus_id ${pdr.cumulus_id}`);
  return pdr;
};

/**
 * @param {Object} params
 * @param {Object} params.cumulusMessage
 * @param {number | undefined} params.collectionCumulusId
 * @param {number} params.providerCumulusId
 * @param {number | undefined} params.executionCumulusId
 * @param {Date | undefined} params.executionCreatedAt
 * @param {{
 *   metricsProvider: string,
 *   cmrProvider: string
 * } | null} [params.metricsAndCmrProvider=null]
 * @param {Knex} params.knex
 * @param {Date} [params.updatedAt=Date.now]
 * @returns {Promise<number>}
 */
const writePdr = async ({
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  executionCreatedAt,
  knex,
  metricsAndCmrProvider = null,
  updatedAt = Date.now(),
}) => {
  let pgPdr;
  // If there is no PDR in the message, then there's nothing to do here, which is fine
  if (!messageHasPdr(cumulusMessage)) {
    return undefined;
  }
  if (!collectionCumulusId) {
    throw new Error('Collection reference is required for a PDR');
  }
  if (!providerCumulusId) {
    throw new Error('Provider reference is required for a PDR');
  }
  const pdrCumulusId = await createRejectableTransaction(knex, async (trx) => {
    pgPdr = await writePdrViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      trx,
      executionCumulusId,
      executionCreatedAt,
      updatedAt,
    });
    return pgPdr.cumulus_id;
  });
  const translatedPdr = await translatePostgresPdrToApiPdr(pgPdr, knex);
  let metricsProvider;
  let cmrProvider;
  if (metricsAndCmrProvider) {
    ({ metricsProvider, cmrProvider } = metricsAndCmrProvider);
  } else {
    const collectionPgModel = new CollectionPgModel();
    ({
      metrics_provider: metricsProvider,
      cmr_provider: cmrProvider,
    } = await collectionPgModel.getMetricsAndCmrProvider(knex, pgPdr.collection_cumulus_id));
  }

  const metricsPdr = {
    metricsProvider,
    cmrProvider,
    ...translatedPdr,
  };
  console.log(metricsPdr);

  await publishPdrSnsMessage(metricsPdr);
  return pdrCumulusId;
};

module.exports = {
  generatePdrRecord,
  writePdrViaTransaction,
  writePdr,
};

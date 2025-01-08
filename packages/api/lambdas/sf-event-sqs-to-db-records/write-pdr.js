'use strict';

const {
  createRejectableTransaction,
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
  generatePdrApiRecordFromMessage,
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
  pdrPgModel = new PdrPgModel(),
  updatedAt,
}) => {
  const pdrRecord = generatePdrRecord({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
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

const writePdr = async ({
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  knex,
  updatedAt = Date.now(),
  esClient,
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
      updatedAt,
    });
    return pgPdr.cumulus_id;
  });
  const pdrToPublish = await translatePostgresPdrToApiPdr(pgPdr, knex);
  await publishPdrSnsMessage(pdrToPublish);
  return pdrCumulusId;
};

module.exports = {
  generatePdrRecord,
  writePdrViaTransaction,
  writePdr,
};

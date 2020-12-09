'use strict';

const {
  tableNames,
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
  getWorklowDuration,
} = require('@cumulus/message/workflows');

const Pdr = require('../../models/pdrs');

const {
  getCumulusIdFromRawInsertQueryResult,
} = require('./utils');

const generatePdrRecord = ({
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  now = Date.now(),
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
    timestamp: new Date(timestamp),
    duration: getWorklowDuration(workflowStartTime, timestamp),
  };
};

const writeRunningPdrViaTransaction = async ({
  pdrRecord,
  trx,
}) => {
  // Can be replaced with native knex usage once
  // https://github.com/knex/knex/pull/4148 is released
  const result = await trx.raw(
    `
      INSERT INTO pdrs (
        "name",
        "status",
        "collection_cumulus_id",
        "provider_cumulus_id",
        "execution_cumulus_id",
        "progress",
        "pan_sent",
        "pan_message",
        "stats",
        "duration",
        "timestamp",
        "created_at"
      ) VALUES (
        :name,
        :status,
        :collection_cumulus_id,
        :provider_cumulus_id,
        :execution_cumulus_id,
        :progress,
        :pan_sent,
        :pan_message,
        :stats,
        :duration,
        :timestamp,
        :created_at
      )
      ON CONFLICT ("name") DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        collection_cumulus_id = EXCLUDED.collection_cumulus_id,
        provider_cumulus_id = EXCLUDED.provider_cumulus_id,
        execution_cumulus_id = EXCLUDED.execution_cumulus_id,
        progress = EXCLUDED.progress,
        pan_sent = EXCLUDED.pan_sent,
        pan_message = EXCLUDED.pan_message,
        stats = EXCLUDED.stats,
        duration = EXCLUDED.duration,
        timestamp = EXCLUDED.timestamp,
        created_at = EXCLUDED.created_at
      WHERE
        pdrs.execution_cumulus_id != :execution_cumulus_id
        OR pdrs.progress < :progress
      RETURNING "cumulus_id"
    `,
    pdrRecord
  );
  return getCumulusIdFromRawInsertQueryResult(result);
};

const writePdrViaTransaction = async ({
  cumulusMessage,
  trx,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
}) => {
  const pdrRecord = generatePdrRecord({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
  });

  if (pdrRecord.status === 'running') {
    return writeRunningPdrViaTransaction({
      pdrRecord,
      trx,
    });
  }

  return trx(tableNames.pdrs)
    .insert(pdrRecord)
    .onConflict('name')
    .merge()
    .returning('cumulus_id');
};

const writePdr = async ({
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  knex,
  pdrModel = new Pdr(),
}) => {
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
  return knex.transaction(async (trx) => {
    // eslint-disable-next-line camelcase
    const [cumulus_id] = await writePdrViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      trx,
      executionCumulusId,
    });
    await pdrModel.storePdrFromCumulusMessage(cumulusMessage);
    // eslint-disable-next-line camelcase
    return cumulus_id;
  });
};

module.exports = {
  generatePdrRecord,
  writeRunningPdrViaTransaction,
  writePdrViaTransaction,
  writePdr,
};

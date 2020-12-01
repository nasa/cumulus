'use strict';

const {
  tableNames,
} = require('@cumulus/db');
const {
  getMessagePdrName,
  messageHasPdr,
} = require('@cumulus/message/PDRs');
const {
  getMetaStatus,
} = require('@cumulus/message/workflows');

const Pdr = require('../../models/pdrs');

const writePdrViaTransaction = async ({
  cumulusMessage,
  trx,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
}) =>
  trx(tableNames.pdrs)
    .insert({
      name: getMessagePdrName(cumulusMessage),
      status: getMetaStatus(cumulusMessage),
      execution_cumulus_id: executionCumulusId,
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
    })
    .returning('cumulus_id');

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
  writePdrViaTransaction,
  writePdr,
};

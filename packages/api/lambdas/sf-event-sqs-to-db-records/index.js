'use strict';

const get = require('lodash/get');

const AggregateError = require('aggregate-error');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const { describeExecution } = require('@cumulus/aws-client/StepFunctions');
const log = require('@cumulus/common/log');
const {
  getKnexClient,
  tableNames,
} = require('@cumulus/db');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');
const {
  getMessageGranules,
  getGranuleStatus,
} = require('@cumulus/message/Granules');
const {
  getMessagePdrName,
  messageHasPdr,
} = require('@cumulus/message/PDRs');
const {
  getMetaStatus,
} = require('@cumulus/message/workflows');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../../lib/cwSfExecutionEventUtils');

const {
  getMessageCollectionCumulusId,
  getMessageProviderCumulusId,
} = require('./utils');

const {
  shouldWriteExecutionToRDS,
  writeExecution,
} = require('./write-execution');

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

const writeGranuleViaTransaction = async ({
  cumulusMessage,
  granule,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  pdrCumulusId,
  trx,
}) =>
  trx(tableNames.granules)
    .insert({
      granule_id: granule.granuleId,
      status: getGranuleStatus(cumulusMessage, granule),
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
      execution_cumulus_id: executionCumulusId,
      pdr_cumulus_id: pdrCumulusId,
    });

/**
 * Write a granule to DynamoDB and Postgres
 *
 * @param {Object} params
 * @param {Object} params.granule - An API granule object
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message, if any
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with Postgres database
 * @param {string} [params.providerCumulusId]
 *   Cumulus ID for provider referenced in workflow message, if any
 * @param {string} [params.pdrCumulusId]
 *   Cumulus ID for PDR referenced in workflow message, if any
 * @param {Object} [params.granuleModel]
 *   Optional override for the granule model writing to DynamoDB
 *
 * @returns {Promise}
 * @throws
 */
const writeGranule = async ({
  granule,
  cumulusMessage,
  executionDescription,
  executionUrl,
  collectionCumulusId,
  executionCumulusId,
  knex,
  providerCumulusId,
  pdrCumulusId,
  granuleModel,
}) =>
  knex.transaction(async (trx) => {
    await writeGranuleViaTransaction({
      cumulusMessage,
      granule,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId,
      pdrCumulusId,
      trx,
    });
    return granuleModel.storeGranuleFromCumulusMessage({
      granule,
      cumulusMessage,
      executionUrl,
      executionDescription,
    });
  });

/**
 * Write granules to DynamoDB and Postgres
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message, if any
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with Postgres database
 * @param {string} [params.providerCumulusId]
 *   Cumulus ID for provider referenced in workflow message, if any
 * @param {string} [params.pdrCumulusId]
 *   Cumulus ID for PDR referenced in workflow message, if any
 * @param {Object} [params.granuleModel]
 *   Optional override for the granule model writing to DynamoDB
 *
 * @returns {Promise<Object[]>}
 *  true if there are no granules on the message, otherwise
 *  results from Promise.allSettled for all granules
 * @throws {Error} - if no collection is provided
 */
const writeGranules = async ({
  cumulusMessage,
  collectionCumulusId,
  executionCumulusId,
  knex,
  providerCumulusId,
  pdrCumulusId,
  granuleModel = new Granule(),
}) => {
  if (!collectionCumulusId) {
    throw new Error('Collection reference is required for granules');
  }

  const granules = getMessageGranules(cumulusMessage);
  const executionArn = getMessageExecutionArn(cumulusMessage);
  const executionUrl = getExecutionUrlFromArn(executionArn);

  let executionDescription;
  try {
    executionDescription = await describeExecution({ executionArn });
  } catch (error) {
    log.error(`Could not describe execution ${executionArn}`, error);
  }

  // Process each granule in a separate transaction via Promise.allSettled
  // so that they can succeed/fail independently
  const results = await Promise.allSettled(granules.map(
    (granule) => writeGranule({
      granule,
      cumulusMessage,
      executionDescription,
      executionUrl,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId,
      pdrCumulusId,
      knex,
      granuleModel,
    })
  ));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const allFailures = failures.map((failure) => failure.reason);
    const aggregateError = new AggregateError(allFailures);
    log.error('Failed writing some granules to Dynamo', aggregateError);
    throw aggregateError;
  }
  return results;
};

const writeRecordsToDynamoDb = async (cumulusMessage) => {
  const executionModel = new Execution();
  const pdrModel = new Pdr();
  const granuleModel = new Granule();

  const results = await Promise.allSettled([
    executionModel.storeExecutionFromCumulusMessage(cumulusMessage),
    pdrModel.storePdrFromCumulusMessage(cumulusMessage),
    granuleModel.storeGranulesFromCumulusMessage(cumulusMessage),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const allFailures = failures.map((failure) => failure.reason);
    const aggregateError = new AggregateError(allFailures);
    log.error('Failed writing some records to Dynamo', aggregateError);
    throw aggregateError;
  }
  return results;
};

const writeRecords = async (cumulusMessage, knex) => {
  const executionArn = getMessageExecutionArn(cumulusMessage);

  const collectionCumulusId = await getMessageCollectionCumulusId(cumulusMessage, knex);
  const isExecutionRDSWriteEnabled = await shouldWriteExecutionToRDS(
    cumulusMessage,
    collectionCumulusId,
    knex
  );

  // If execution is not written to RDS, then PDRs/granules which reference
  // execution should not be written to RDS either
  if (!isExecutionRDSWriteEnabled) {
    return writeRecordsToDynamoDb(cumulusMessage);
  }

  const providerCumulusId = await getMessageProviderCumulusId(cumulusMessage, knex);

  try {
    const executionCumulusId = await writeExecution({
      cumulusMessage,
      knex,
    });
    // PDR write only attempted if execution saved
    const pdrCumulusId = await writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
      executionCumulusId,
    });
    return await writeGranules({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId,
      pdrCumulusId,
      knex,
    });
  } catch (error) {
    log.error(`Failed to write records for ${executionArn}`, error);
    throw error;
  }
};

const handler = async (event) => {
  const knex = await getKnexClient({
    env: {
      ...process.env,
      ...event.env,
    },
  });

  const sqsMessages = get(event, 'Records', []);

  return Promise.all(sqsMessages.map(async (message) => {
    const executionEvent = parseSQSMessageBody(message);
    const cumulusMessage = await getCumulusMessageFromExecutionEvent(executionEvent);

    try {
      return await writeRecords(cumulusMessage, knex);
    } catch (error) {
      log.fatal(`Writing message failed: ${JSON.stringify(message)}`);
      return sendSQSMessage(process.env.DeadLetterQueue, message);
    }
  }));
};

module.exports = {
  handler,
  writeGranuleViaTransaction,
  writeGranules,
  writeExecution,
  writePdr,
  writeRecords,
};

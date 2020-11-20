'use strict';

const get = require('lodash/get');

const AggregateError = require('aggregate-error');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');

const log = require('@cumulus/common/log');
const {
  getKnexClient,
} = require('@cumulus/db');
const {
  getMessageExecutionArn,
} = require('@cumulus/message/Executions');
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

const {
  writePdr,
} = require('./write-pdr');

const {
  writeGranules,
} = require('./write-granules');

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
  writeRecords,
};

'use strict';

const get = require('lodash/get');

const AggregateError = require('aggregate-error');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');

const log = require('@cumulus/common/log');
const {
  getKnexClient,
} = require('@cumulus/db');
const {
  getCollectionNameAndVersionFromMessage,
} = require('@cumulus/message/Collections');
// const {
//   getMessageExecutionArn,
// } = require('@cumulus/message/Executions');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../../lib/cwSfExecutionEventUtils');

const {
  getMessageCollectionCumulusId,
  getMessageProviderCumulusId,
} = require('./utils');

const {
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
  // const executionArn = getMessageExecutionArn(cumulusMessage);

  // const isExecutionRDSWriteEnabled = shouldWriteExecutionToRDS({
  //   cumulusMessage,
  //   messageAsyncOperationId,
  //   messageParentExecutionArn,
  //   collectionCumulusId,
  //   asyncOperationCumulusId,
  //   parentExecutionCumulusId,
  // });

  let collectionCumulusId;
  let executionCumulusId;

  try {
    const messageCollectionNameVersion = getCollectionNameAndVersionFromMessage(cumulusMessage);
    collectionCumulusId = await getMessageCollectionCumulusId(
      messageCollectionNameVersion,
      knex
    );

    executionCumulusId = await writeExecution({
      cumulusMessage,
      messageCollectionNameVersion,
      collectionCumulusId,
      knex,
    });
  } catch (error) {
    // If execution is not written to RDS, then PDRs/granules which reference
    // execution should not be written to RDS either
    return writeRecordsToDynamoDb(cumulusMessage);
  }

  const providerCumulusId = await getMessageProviderCumulusId(cumulusMessage, knex);

  // PDR write only attempted if execution saved
  const pdrCumulusId = await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
    executionCumulusId,
  });

  return writeGranules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdrCumulusId,
    knex,
  });
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

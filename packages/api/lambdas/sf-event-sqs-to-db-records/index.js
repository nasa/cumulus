'use strict';

const get = require('lodash/get');

const AggregateError = require('aggregate-error');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');

const log = require('@cumulus/common/log');
const {
  getKnexClient,
} = require('@cumulus/db');
const { UnmetRequirementsError } = require('@cumulus/errors');
const {
  getCollectionNameAndVersionFromMessage,
} = require('@cumulus/message/Collections');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../../lib/cwSfExecutionEventUtils');

const {
  getCollectionCumulusId,
  getMessageProviderCumulusId,
} = require('./utils');

const {
  getWriteExecutionRequirements,
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

const writeRecords = async (
  cumulusMessage,
  knex,
  granuleModel = new Granule()
) => {
  const messageCollectionNameVersion = getCollectionNameAndVersionFromMessage(cumulusMessage);
  const collectionCumulusId = await getCollectionCumulusId(
    messageCollectionNameVersion,
    knex
  );

  let asyncOperationCumulusId;
  let parentExecutionCumulusId;
  try {
    (
      { asyncOperationCumulusId, parentExecutionCumulusId } = await getWriteExecutionRequirements({
        cumulusMessage,
        messageCollectionNameVersion,
        collectionCumulusId,
        knex,
      })
    );
  } catch (error) {
    // If any requirements for writing executions to Postgres were not met,
    // then PDR/granules should not be written to Postgres either since they
    // reference executions, so bail out to writing execution/PDR/granule
    // records to Dynamo.
    if (error instanceof UnmetRequirementsError) {
      return writeRecordsToDynamoDb(cumulusMessage);
    }
    throw error;
  }

  const executionCumulusId = await writeExecution({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    knex,
  });

  const providerCumulusId = await getMessageProviderCumulusId(cumulusMessage, knex);

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
    granuleModel,
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

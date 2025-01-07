//@ts-check

'use strict';

const get = require('lodash/get');
const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');

const Logger = require('@cumulus/logger');
const {
  getKnexClient,
} = require('@cumulus/db');
const {
  UnmetRequirementsError,
} = require('@cumulus/errors');
const {
  getMessageAsyncOperationId,
} = require('@cumulus/message/AsyncOperations');
const {
  getCollectionNameAndVersionFromMessage,
} = require('@cumulus/message/Collections');
const {
  getMessageExecutionParentArn,
} = require('@cumulus/message/Executions');
const { getCumulusMessageFromExecutionEvent } = require('@cumulus/message/StepFunctions');
const { isEventBridgeEvent } = require('@cumulus/aws-client/Lambda');

const {
  getCollectionCumulusId,
  getMessageProviderCumulusId,
  getAsyncOperationCumulusId,
  getParentExecutionCumulusId,
} = require('../../lib/writeRecords/utils');

const {
  shouldWriteExecutionToPostgres,
  writeExecutionRecordFromMessage,
} = require('../../lib/writeRecords/write-execution');

const {
  writePdr,
} = require('./write-pdr');

const {
  writeGranulesFromMessage,
} = require('../../lib/writeRecords/write-granules');

const log = new Logger({ sender: '@cumulus/api/lambdas/sf-event-sqs-to-db-records' });

/**
 * Write records to data stores.
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - Cumulus workflow message
 * @param {Knex} params.knex - Knex client
 * @param {EsClient} params.esClient - Elasticsearch client
 * @param {Object} [params.testOverrides]
 *   Optional override/mock object used for testing
 */
const writeRecords = async ({
  cumulusMessage,
  knex,
  esClient,
  testOverrides = {},
}) => {
  const messageCollectionNameVersion = getCollectionNameAndVersionFromMessage(cumulusMessage);
  const messageAsyncOperationId = getMessageAsyncOperationId(cumulusMessage);
  const messageParentExecutionArn = getMessageExecutionParentArn(cumulusMessage);
  const [
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
  ] = await Promise.all([
    getCollectionCumulusId(
      messageCollectionNameVersion,
      knex
    ),
    getAsyncOperationCumulusId(
      messageAsyncOperationId,
      knex
    ),
    getParentExecutionCumulusId(
      messageParentExecutionArn,
      knex
    ),
  ]);

  const fieldsToMeetRequirements = {
    messageCollectionNameVersion,
    collectionCumulusId,
    messageAsyncOperationId,
    asyncOperationCumulusId,
    messageParentExecutionArn,
    parentExecutionCumulusId,
  };
  if (!shouldWriteExecutionToPostgres(fieldsToMeetRequirements)) {
    log.debug(`Could not satisfy requirements for writing records, fieldsToMeetRequirements: ${JSON.stringify(fieldsToMeetRequirements)}`);
    throw new UnmetRequirementsError('Could not satisfy requirements for writing records to PostgreSQL. No records written to the database.');
  }

  const executionCumulusId = await writeExecutionRecordFromMessage({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    knex,
    esClient,
  });

  const providerCumulusId = await getMessageProviderCumulusId(cumulusMessage, knex);

  await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
    executionCumulusId,
    esClient,
  });

  return writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    esClient,
    knex,
    testOverrides,
  });
};
/**
 * @typedef {import('aws-lambda').SQSRecord} SQSRecord
 * @typedef {{Records: Array<SQSRecord>, env: {[key: string]: any}, [key: string]: any}} LambdaEvent
 */

/**
 * Lambda handler for StepFunction Events that writes records or records errors to the DLQ
 *
 * @param {LambdaEvent} event - Input payload
 * @returns {Promise<{batchItemFailures: Array<{itemIdentifier: string}>}>}
 */
const handler = async (event) => {
  const knex = await getKnexClient({
    env: {
      ...process.env,
      ...event.env,
    },
  });

  const sqsMessages = get(event, 'Records', []);
  const batchItemFailures = [];

  await Promise.all(sqsMessages.map(async (message) => {
    let cumulusMessage;

    const executionEvent = parseSQSMessageBody(message);
    try {
      if (isEventBridgeEvent(executionEvent)) {
        cumulusMessage = await getCumulusMessageFromExecutionEvent(executionEvent);
      } else {
        throw new TypeError('SQSMessage body not in expected EventBridgeEvent format');
      }
    } catch (error) {
      log.error(`Writing message failed on getting message from execution event: ${JSON.stringify(message)}`, error);
      return batchItemFailures.push({ itemIdentifier: message.messageId });
    }
    try {
      return await writeRecords({ ...event, cumulusMessage, knex });
    } catch (error) {
      log.error(`Writing message failed: ${JSON.stringify(message)}`, error);
      if (!process.env.DeadLetterQueue) {
        log.error('DeadLetterQueue not configured');
        return undefined;
      }
      return sendSQSMessage(
        process.env.DeadLetterQueue,
        {
          ...message,
          error: error.toString(),
        }
      );
    }
  }));

  return { batchItemFailures };
};

module.exports = {
  handler,
  writeRecords,
};

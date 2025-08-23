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
@typedef {'execution' | 'granule' | 'pdr'} RecordType
*/

/**
@typedef {Object} RecordWriteFlags
@property {boolean} shouldWriteExecutionRecords
@property {boolean} shouldWriteGranuleRecords
@property {boolean} shouldWritePdrRecords
*/

/**
 * @typedef {Object} CumulusMessage
 * @property {Object} [meta]
 * @property {string} [meta.reportMessageSource]
 * @property {string} [meta.workflow_name]
 * @property {string} [meta.status]
 * @property {Object} [cumulus_meta]
 * @property {{
 *   [workflowName: string]: {
 *     [status: string]: RecordType[]
 *   }
 * }} [cumulus_meta.sf_event_sqs_to_db_records_types]
 */

/**
 * Determines whether a record of the given type should be written to the database.
 *
 * @param {RecordType[] | undefined} configuredRecordTypes - An optional list of record types
 *   that are allowed to be written. If undefined, all record types are allowed.
 * @param {RecordType} recordType - The type of record to check.
 * @returns {boolean} True if the record type should be written; otherwise, false.
 */
const isRecordTypeWritable = (configuredRecordTypes, recordType) =>
  (configuredRecordTypes === undefined || configuredRecordTypes.includes(recordType));

/**
 * Determines which types of records should be written to the database.
 *
 * @param {CumulusMessage} cumulusMessage - The input Cumulus message.
 * @returns {RecordWriteFlags} An object indicating which record types should be written.
 */
const determineRecordWriteFlags = (cumulusMessage) => {
  const defaultWriteFlags = {
    shouldWriteExecutionRecords: true,
    shouldWriteGranuleRecords: true,
    shouldWritePdrRecords: true,
  };

  const reportMessageSource = get(cumulusMessage, 'meta.reportMessageSource');
  if (reportMessageSource) {
    log.debug(`determineRecordWriteFlags: reportMessageSource is '${reportMessageSource}', writing all records`);
    return defaultWriteFlags;
  }

  const workflowName = get(cumulusMessage, 'meta.workflow_name');
  const status = get(cumulusMessage, 'meta.status');
  const configuredRecordTypes = get(
    cumulusMessage,
    `cumulus_meta.sf_event_sqs_to_db_records_types.${workflowName}.${status}`
  );

  const writeFlags = {
    shouldWriteExecutionRecords: isRecordTypeWritable(configuredRecordTypes, 'execution'),
    shouldWriteGranuleRecords: isRecordTypeWritable(configuredRecordTypes, 'granule'),
    shouldWritePdrRecords: isRecordTypeWritable(configuredRecordTypes, 'pdr'),
  };

  log.debug(`determineRecordWriteFlags: determined write flags: ${JSON.stringify(writeFlags)}`);
  return writeFlags;
};

/**
 * Write records to data stores.
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - Cumulus workflow message
 * @param {Knex} params.knex - Knex client
 * @param {Object} [params.testOverrides]
 *   Optional override/mock object used for testing
 */
const writeRecords = async ({
  cumulusMessage,
  knex,
  testOverrides = {},
}) => {
  const messageCollectionNameVersion = getCollectionNameAndVersionFromMessage(cumulusMessage);
  const messageAsyncOperationId = getMessageAsyncOperationId(cumulusMessage);
  const messageParentExecutionArn = getMessageExecutionParentArn(cumulusMessage);

  const {
    shouldWriteExecutionRecords,
    shouldWriteGranuleRecords,
    shouldWritePdrRecords,
  } = determineRecordWriteFlags(cumulusMessage);

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

  let executionCumulusId;
  if (shouldWriteExecutionRecords) {
    executionCumulusId = await writeExecutionRecordFromMessage({
      cumulusMessage,
      collectionCumulusId,
      asyncOperationCumulusId,
      parentExecutionCumulusId,
      knex,
    });
  }

  const providerCumulusId = await getMessageProviderCumulusId(cumulusMessage, knex);

  if (shouldWritePdrRecords) {
    await writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
      executionCumulusId,
    });
  }

  if (shouldWriteGranuleRecords) {
    return writeGranulesFromMessage({
      cumulusMessage,
      executionCumulusId,
      knex,
      testOverrides,
    });
  }
  return undefined;
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

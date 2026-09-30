//@ts-check

'use strict';

const get = require('lodash/get');
const isNil = require('lodash/isNil');
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
  getCollectionMetricsAndCmrProvider,
  getMessageProviderCumulusId,
  getAsyncOperationCumulusId,
  getParentExecution,
} = require('../../lib/writeRecords/utils');

const {
  shouldWriteExecutionToPostgres,
  writeExecutionRecordFromMessage,
} = require('../../lib/writeRecords/write-execution');

const {
  writePdr,
} = require('./write-pdr');

const {
  writeGranuleExecutionAssociationsFromMessage,
  writeGranulesFromMessage,
} = require('../../lib/writeRecords/write-granules');

const log = new Logger({ sender: '@cumulus/api/lambdas/sf-event-sqs-to-db-records' });

/**
 * @typedef {import('@cumulus/types/message').CumulusMessage} CumulusMessage
 * @typedef {import('@cumulus/types/message').RecordType} RecordType
 * @typedef {import('knex').Knex} Knex
 */

/**
@typedef {object} RecordWriteFlags
@property {boolean} shouldWriteExecutionRecords
@property {boolean} shouldWriteGranuleRecords
@property {boolean} shouldWritePdrRecords
 */

/**
 * Determines whether a record of the given type should be written to the database.
 *
 * @param {RecordType[] | undefined | null } configuredRecordTypes - An optional list of
 *   record types that are allowed to be written. If undefined, all record types are allowed.
 * @param {RecordType} recordType - The type of record to check.
 * @returns {boolean} True if the record type should be written; otherwise, false.
 */
function isRecordTypeWritable(configuredRecordTypes, recordType) {
  return (isNil(configuredRecordTypes) || configuredRecordTypes.includes(recordType));
}

/**
 * Determines which types of records should be written to the database.
 *
 * @param {CumulusMessage} cumulusMessage - The input Cumulus message.
 * @returns {RecordWriteFlags} An object indicating which record types should be written.
 */
const determineRecordWriteFlags = (cumulusMessage) => {
  const logPrefix = getLogPrefix(cumulusMessage);
  const defaultWriteFlags = {
    shouldWriteExecutionRecords: true,
    shouldWriteGranuleRecords: true,
    shouldWritePdrRecords: true,
  };

  const reportMessageSource = get(cumulusMessage, 'meta.reportMessageSource');
  if (reportMessageSource) {
    log.debug(`${logPrefix}: determineRecordWriteFlags: reportMessageSource is '${reportMessageSource}', writing all records`);
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

  log.debug(`${logPrefix}: determineRecordWriteFlags: determined write flags: ${JSON.stringify(writeFlags)}`);
  return writeFlags;
};

/**
 * Write records to data stores.
 *
 * @param {Object} params
 * @param {CumulusMessage} params.cumulusMessage - Cumulus workflow message
 * @param {Knex} params.knex - Knex client
 * @param {Object} [params.testOverrides] -
 *   Optional override/mock object used for testing
 */
const writeRecords = async ({
  cumulusMessage,
  knex,
  testOverrides = {},
}) => {
  const logPrefix = getLogPrefix(cumulusMessage);
  log.info(`${logPrefix}: Starting writeRecords processing`);
  
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
    parentExecution,
  ] = await Promise.all([
    getCollectionCumulusId(
      messageCollectionNameVersion,
      knex
    ),
    getAsyncOperationCumulusId(
      messageAsyncOperationId,
      knex
    ),
    getParentExecution(
      messageParentExecutionArn,
      knex
    ),
  ]);

  const {
    cumulus_id: parentExecutionCumulusId,
    created_at: parentExecutionCreatedAt,
  } = parentExecution || {};

  const fieldsToMeetRequirements = {
    messageCollectionNameVersion,
    collectionCumulusId,
    messageAsyncOperationId,
    asyncOperationCumulusId,
    messageParentExecutionArn,
    parentExecutionCumulusId,
    parentExecutionCreatedAt,
  };
  if (!shouldWriteExecutionToPostgres(fieldsToMeetRequirements)) {
    log.debug(`${logPrefix}: Could not satisfy requirements for writing records, fieldsToMeetRequirements: ${JSON.stringify(fieldsToMeetRequirements)}`);
    throw new UnmetRequirementsError('Could not satisfy requirements for writing records to PostgreSQL. No records written to the database.');
  }
  let metricsAndCmrProvider = {
    metricsProvider: '',
    cmrProvider: '',
  };
  if (collectionCumulusId) {
    metricsAndCmrProvider = await getCollectionMetricsAndCmrProvider(
      collectionCumulusId,
      knex
    );
  }

  let executionCumulusId;
  let executionCreatedAt;
  if (shouldWriteExecutionRecords) {
    log.debug(`${logPrefix}: Writing execution records to PostgreSQL`);
    const execution = await writeExecutionRecordFromMessage({
      cumulusMessage,
      collectionCumulusId,
      asyncOperationCumulusId,
      parentExecutionCumulusId,
      parentExecutionCreatedAt,
      metricsAndCmrProvider,
      knex,
    });

    ({
      cumulus_id: executionCumulusId,
      created_at: executionCreatedAt,
    } = execution);
  }

  const providerCumulusId = await getMessageProviderCumulusId(cumulusMessage, knex);

  if (shouldWritePdrRecords) {
    log.debug(`${logPrefix}: Writing PDR records to PostgreSQL`);
    await writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId,
      executionCreatedAt,
      metricsAndCmrProvider,
      knex,
    });
  }

  if (shouldWriteGranuleRecords) {
    log.debug(`${logPrefix}: Writing Granule records to PostgreSQL`);
    const result = await writeGranulesFromMessage({
      cumulusMessage,
      executionCumulusId,
      executionCreatedAt,
      metricsAndCmrProvider,
      knex,
      testOverrides,
    });
    log.info(`${logPrefix}: Successfully completed writeRecords processing`);
    return result;
  }

  if (executionCumulusId && !shouldWriteGranuleRecords) {
    log.debug(`${logPrefix}: Writing Granule Execution Associations`);
    const result = await writeGranuleExecutionAssociationsFromMessage({
      cumulusMessage,
      executionCumulusId,
      executionCreatedAt,
      knex,
    });
    log.info(`${logPrefix}: Successfully completed writeRecords processing`);
    return result;
  }
  log.info(`${logPrefix}: Successfully completed writeRecords processing (No granules written)`);
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
    let logPrefix = '[Unknown Context]';

    const executionEvent = parseSQSMessageBody(message);
    try {
      if (isEventBridgeEvent(executionEvent)) {
        cumulusMessage = await getCumulusMessageFromExecutionEvent(executionEvent);
        logPrefix = getLogPrefix(cumulusMessage);
      } else {
        throw new TypeError('SQSMessage body not in expected EventBridgeEvent format');
      }
    } catch (error) {
      log.error(`${logPrefix}: Writing message failed on getting message from execution event: ${JSON.stringify(message)}`, error);
      return batchItemFailures.push({ itemIdentifier: message.messageId });
    }
    try {
      return await writeRecords({ ...event, cumulusMessage, knex });
    } catch (error) {
      log.error(`${logPrefix}: Writing message failed: ${JSON.stringify(message)}`, error);
      
      if (!process.env.DeadLetterQueue) {
        log.error(`${logPrefix}: DeadLetterQueue not configured`);
        return undefined;
      }
      log.info(`${logPrefix}: Sending failed message to DLQ: ${process.env.DeadLetterQueue}`);
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

/**
 * Extracts tracing context (Execution ID and Granule IDs) for logs
 * 
 * @param {CumulusMessage} cumulusMessage 
 * @returns {string} Formatted log prefix
 */
const getLogPrefix = (cumulusMessage) => {
  if (!cumulusMessage) return '[Unknown Context]';
  const executionId = get(cumulusMessage, 'cumulus_meta.execution_name', 'UnknownExecutionId');
  const granules = get(cumulusMessage, 'payload.granules', []);
  const granuleIds = granules.map((g) => {
    // Find the file in the granule where type is 'data'
    const dataFile = (g.files || []).find((file) => file.type === 'data');
    // Extract the file name, or fallback to the granuleId property if not found
    return dataFile ? (dataFile.fileName || dataFile.name) : g.granuleId;
  }).filter(Boolean);
  const granuleIdString = granuleIds.length ? ` | GranuleIds: ${granuleIds.join(', ')}` : '';
  return `[GranuleId:${granuleIdString} - ExecutionId:${executionId}]`;
};

module.exports = {
  handler,
  writeRecords,
};
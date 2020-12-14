'use strict';

const AggregateError = require('aggregate-error');

const { s3 } = require('@cumulus/aws-client/services');
const CmrUtils = require('@cumulus/cmrjs/cmr-utils');
const log = require('@cumulus/common/log');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
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
  getMessageProvider,
} = require('@cumulus/message/Providers');
const {
  getMessageWorkflowStartTime,
  getWorkflowDuration,
} = require('@cumulus/message/workflows');

const FileUtils = require('../../lib/FileUtils');
const {
  getExecutionProcessingTimeInfo,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
} = require('../../lib/granules');
const {
  parseException,
  getGranuleProductVolume,
} = require('../../lib/utils');
const Granule = require('../../models/granules');

const generateGranuleRecord = async ({
  message,
  granule,
  executionUrl,
  processingTimeInfo = {},
  cmrUtils = CmrUtils,
  fileUtils = FileUtils,
  now = Date.now(),
}) => {
  const {
    files,
    granuleId,
    cmrLink,
    published = false,
  } = granule;

  const provider = getMessageProvider(message);
  const granuleFiles = await fileUtils.buildDatabaseFiles({
    s3,
    providerURL: buildURL(provider),
    files,
  });

  const timestamp = now;
  const workflowStartTime = getMessageWorkflowStartTime(message);
  const temporalInfo = await cmrUtils.getGranuleTemporalInfo(granule);

  return {
    granuleId,
    // pdrName: getMessagePdrName(message),
    // collectionId,
    status: getGranuleStatus(message, granule),
    provider: provider.id,
    execution: executionUrl,
    cmrLink: cmrLink,
    files: granuleFiles,
    error: parseException(message.exception),
    createdAt: workflowStartTime,
    published,
    timestamp,
    updatedAt: now,
    // Duration is also used as timeToXfer for the EMS report
    duration: getWorkflowDuration(workflowStartTime, timestamp),
    productVolume: getGranuleProductVolume(granuleFiles),
    timeToPreprocess: getGranuleTimeToPreprocess(granule),
    timeToArchive: getGranuleTimeToArchive(granule),
    ...processingTimeInfo,
    ...temporalInfo,
  };
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
 * @param {Object} [params.executionDescription]
 *   Description of the Step Function execution for the workflow, if any
 * @param {string} [params.executionUrl]
 *   Step Function execution URL for the workflow, if any
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
  collectionCumulusId,
  executionCumulusId,
  knex,
  executionDescription,
  executionUrl,
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
  const executionDescription = await granuleModel.describeGranuleExecution(executionArn);
  const processingTimeInfo = getExecutionProcessingTimeInfo(executionDescription);

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

module.exports = {
  writeGranuleViaTransaction,
  writeGranules,
};

'use strict';

const AggregateError = require('aggregate-error');
const flow = require('lodash/flow');
const pick = require('lodash/pick');

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
  getGranuleProductVolume,
} = require('../../lib/granules');
const {
  parseException,
} = require('../../lib/utils');
const Granule = require('../../models/granules');

const generateGranuleRecord = async ({
  cumulusMessage,
  granule,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  pdrCumulusId,
  files,
  processingTimeInfo = {},
  cmrUtils = CmrUtils,
  timestamp = Date.now(),
  updatedAt = Date.now(),
}) => {
  const {
    granuleId,
    cmrLink,
    published = false,
  } = granule;

  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const temporalInfo = await cmrUtils.getGranuleTemporalInfo(granule);

  return {
    granule_id: granuleId,
    status: getGranuleStatus(cumulusMessage, granule),
    cmr_link: cmrLink,
    error: parseException(cumulusMessage.exception),
    published,
    created_at: new Date(workflowStartTime),
    updated_at: new Date(updatedAt),
    timestamp: new Date(timestamp),
    // Duration is also used as timeToXfer for the EMS report
    duration: getWorkflowDuration(workflowStartTime, timestamp),
    product_volume: getGranuleProductVolume(files),
    time_to_process: getGranuleTimeToPreprocess(granule),
    time_to_archive: getGranuleTimeToArchive(granule),
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: providerCumulusId,
    execution_cumulus_id: executionCumulusId,
    pdr_cumulus_id: pdrCumulusId,
    // Temporal info from CMR
    beginning_date_time: temporalInfo.beginningDateTime,
    ending_date_time: temporalInfo.endingDateTime,
    production_date_time: temporalInfo.productionDateTime,
    last_update_date_time: temporalInfo.lastUpdateDateTime,
    // Processing info from execution
    processing_start_date_time: processingTimeInfo.processingStartDateTime,
    processing_end_date_time: processingTimeInfo.processingEndDateTime,
  };
};

// const writeGranuleFilesViaTransaction = async (files, trx) => {
//   return Promise.all(files.map((file) => {
//     return trx(tableNames.files)
//       .insert(file)
//       .onConflict(['bucket', 'key'])
//       .merge();
//   }));
// };

const generateFileRecord = (file) =>
  pick(
    {
      ...file,
      checksum_type: file.checksumType,
      checksum_value: file.checksum,
      // TODO: do we really need both of these properties?
      filename: file.fileName,
      file_name: file.fileName,
    },
    [
      'bucket',
      'checksum_type',
      'checksum_value',
      'filename',
      'file_name',
      'key',
      'name',
      'path',
      'size',
      'source',
    ]
  );

const generateFileRecords = async ({
  cumulusMessage,
  files,
  fileUtils = FileUtils,
}) => {
  // TODO: move this
  const provider = getMessageProvider(cumulusMessage);
  return Promise.all(files.map(async (file) => {
    // TODO: I think this is necessary to set properties like
    // `key`, which is required for the Postgres schema
    const updatedFile = await fileUtils.buildDatabaseFile(
      s3(),
      buildURL(provider),
      file
    );
    return generateFileRecord(updatedFile);
  }));
};

const writeGranuleViaTransaction = async ({
  cumulusMessage,
  granule,
  processingTimeInfo,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  pdrCumulusId,
  trx,
}) => {
  const files = await generateFileRecords({
    cumulusMessage,
    files: granule.files,
  });

  const granuleRecord = await generateGranuleRecord({
    cumulusMessage,
    granule,
    files,
    processingTimeInfo,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdrCumulusId,
  });

  return trx(tableNames.granules)
    .insert(granuleRecord)
    .onConflict(['granule_id', 'collection_cumulus_id'])
    .merge()
    .returning('cumulus_id');
};

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
 * @param {string} [params.executionUrl]
 *   Step Function execution URL for the workflow, if any
 * @param {Object} [params.processingTimeInfo]
 *   Processing time information for the granule, if any
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
  executionUrl,
  processingTimeInfo,
  providerCumulusId,
  pdrCumulusId,
  granuleModel,
}) =>
  knex.transaction(async (trx) => {
    await writeGranuleViaTransaction({
      cumulusMessage,
      granule,
      processingTimeInfo,
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
      processingTimeInfo,
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
 * @throws {Error}
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
      processingTimeInfo,
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
  generateFileRecord,
  generateFileRecords,
  generateGranuleRecord,
  writeGranuleViaTransaction,
  writeGranules,
};

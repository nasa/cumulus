'use strict';

const AggregateError = require('aggregate-error');

const { s3 } = require('@cumulus/aws-client/services');
const CmrUtils = require('@cumulus/cmrjs/cmr-utils');
const log = require('@cumulus/common/log');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
  translateApiFiletoPostgresFile,
  FilePgModel,
  GranulePgModel,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');
const { getCollectionIdFromMessage } = require('@cumulus/message/Collections');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');
const {
  getMessageGranules,
  getGranuleStatus,
  getGranuleQueryFields,
} = require('@cumulus/message/Granules');
const {
  getMessagePdrName,
} = require('@cumulus/message/PDRs');
const {
  getMessageProvider,
} = require('@cumulus/message/Providers');
const {
  getMessageWorkflowStartTime,
  getMetaStatus,
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

/**
 * Generate a Granule record to save to the core database from a Cumulus message
 * and other contextual information
 *
 * @param {Object} params
 * @param {string} params.collectionId - Collection ID for the workflow
 * @param {Object} params.granule - Granule object from workflow message
 * @param {Array<Object>} params.files - Granule file objects
 * @param {Object} params.queryFields - Arbitrary query fields for the granule
 * @param {number} params.collectionCumulusId
 *   Cumulus ID of collection referenced in workflow message
 * @param {number} params.providerCumulusId
 *   Cumulus ID of provider referenced in workflow message
 * @param {number} params.pdrCumulusId
 *   Cumulus ID of PDR referenced in workflow message
 * @param {Object} [params.processingTimeInfo={}]
 *   Info describing the processing time for the granule
 * @param {Object} [params.cmrUtils=CmrUtils]
 *   Utilities for interacting with CMR
 * @param {number} [params.timestamp] - Timestamp for granule record. Defaults to now.
 * @param {number} [params.updatedAt] - Updated timestamp for granule record. Defaults to now.
 * @returns {Promise<Object>} - a granule record
 */
const generateGranuleRecord = async ({
  error,
  granule,
  files,
  workflowStartTime,
  workflowStatus,
  queryFields,
  collectionCumulusId,
  providerCumulusId,
  pdrCumulusId,
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

  const temporalInfo = await cmrUtils.getGranuleTemporalInfo(granule);

  return {
    granule_id: granuleId,
    status: getGranuleStatus(workflowStatus, granule),
    cmr_link: cmrLink,
    error,
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
    pdr_cumulus_id: pdrCumulusId,
    // Temporal info from CMR
    beginning_date_time: temporalInfo.beginningDateTime,
    ending_date_time: temporalInfo.endingDateTime,
    production_date_time: temporalInfo.productionDateTime,
    last_update_date_time: temporalInfo.lastUpdateDateTime,
    // Processing info from execution
    processing_start_date_time: processingTimeInfo.processingStartDateTime,
    processing_end_date_time: processingTimeInfo.processingEndDateTime,
    query_fields: queryFields,
  };
};

/**
 * Generate a file record to save to the core database.
 *
 * @param {Object} params
 * @param {Object} params.file - File object
 * @param {number} params.granuleCumulusId
 *   Cumulus ID of the granule for this file
 * @returns {Object} - a file record
 */
const generateFileRecord = ({ file, granuleCumulusId }) => ({
  ...translateApiFiletoPostgresFile(file),
  granule_cumulus_id: granuleCumulusId,
});

/**
 * Generate file records to save to the core database.
 *
 * @param {Object} params
 * @param {Object} params.files - File objects
 * @param {number} params.granuleCumulusId
 *   Cumulus ID of the granule for this file
 * @returns {Array<Object>} - file records
 */
const generateFileRecords = async ({
  files,
  granuleCumulusId,
}) => files.map((file) => generateFileRecord({ file, granuleCumulusId }));

const writeFilesViaTransaction = async ({
  fileRecords,
  trx,
  filePgModel = new FilePgModel(),
}) =>
  Promise.all(fileRecords.map(
    (fileRecord) => filePgModel.upsert(trx, fileRecord)
  ));

/**
 * Get the cumulus ID from a query result or look it up in the database.
 *
 * For certain cases, such as an upsert query that matched no rows, an empty
 * database result is returned, so no cumulus ID will be returned. In those
 * cases, this function will lookup the granule cumulus ID from the record.
 *
 * @param {Object} params
 * @param {Object} params.trx - A Knex transaction
 * @param {Object} params.queryResult - Query result
 * @param {Object} params.granuleRecord - A granule record
 * @param {Object} params.granulePgModel - Database model for granule data
 * @returns {Promise<number|undefined>} - Cumulus ID for the granule record
 */
const getGranuleCumulusIdFromQueryResultOrLookup = async ({
  queryResult = [],
  granuleRecord,
  trx,
  granulePgModel = new GranulePgModel(),
}) => {
  let [granuleCumulusId] = queryResult;
  if (!granuleCumulusId) {
    granuleCumulusId = await granulePgModel.getRecordCumulusId(
      trx,
      { granule_id: granuleRecord.granule_id }
    );
  }
  return granuleCumulusId;
};

const writeGranuleAndFilesViaTransaction = async ({
  granule,
  processingTimeInfo,
  error,
  provider,
  workflowStartTime,
  workflowStatus,
  queryFields,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  pdrCumulusId,
  fileUtils = FileUtils,
  trx,
  updatedAt,
}) => {
  const { files = [] } = granule;
  // This is necessary to set properties like
  // `key`, which is required for the Postgres schema. And
  // `size` which is used to calculate the granule product
  // volume
  const updatedFiles = await fileUtils.buildDatabaseFiles({
    s3: s3(),
    providerURL: buildURL(provider),
    files,
  });

  const granuleRecord = await generateGranuleRecord({
    error,
    granule,
    files: updatedFiles,
    workflowStartTime,
    workflowStatus,
    queryFields,
    collectionCumulusId,
    providerCumulusId,
    pdrCumulusId,
    processingTimeInfo,
    updatedAt,
  });

  const upsertQueryResult = await upsertGranuleWithExecutionJoinRecord(
    trx,
    granuleRecord,
    executionCumulusId
  );
  // Ensure that we get a granule ID for the files even if the
  // upsert query returned an empty result
  const granuleCumulusId = await getGranuleCumulusIdFromQueryResultOrLookup({
    trx,
    queryResult: upsertQueryResult,
    granuleRecord,
  });

  let fileRecords = [];

  if (workflowStatus !== 'running') {
    fileRecords = await generateFileRecords({
      files: updatedFiles,
      granuleCumulusId,
    });
  }

  return writeFilesViaTransaction({
    fileRecords,
    trx,
  });
};

/**
 * Write a granule to DynamoDB and Postgres
 *
 * @param {Object} params
 * @param {string} params.collectionId - Collection ID for the workflow
 * @param {Object} params.granule - An API granule object
 * @param {Object} params.provider - Provider object
 * @param {string} params.workflowStatus - Workflow status
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message, if any
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with Postgres database
 * @param {Object} [params.error] - Workflow error, if any
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
  collectionId,
  granule,
  pdrName,
  provider,
  workflowStartTime,
  workflowStatus,
  queryFields,
  collectionCumulusId,
  executionCumulusId,
  knex,
  error,
  executionUrl,
  processingTimeInfo,
  providerCumulusId,
  pdrCumulusId,
  granuleModel,
  updatedAt = Date.now(),
}) =>
  knex.transaction(async (trx) => {
    await writeGranuleAndFilesViaTransaction({
      granule,
      processingTimeInfo,
      error,
      provider,
      workflowStartTime,
      workflowStatus,
      queryFields,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId,
      pdrCumulusId,
      trx,
      updatedAt,
    });
    return granuleModel.storeGranuleFromCumulusMessage({
      granule,
      executionUrl,
      collectionId,
      provider,
      workflowStartTime,
      error,
      pdrName,
      workflowStatus,
      processingTimeInfo,
      queryFields,
      updatedAt,
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
  const provider = getMessageProvider(cumulusMessage);
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const error = parseException(cumulusMessage.exception);
  const workflowStatus = getMetaStatus(cumulusMessage);
  const collectionId = getCollectionIdFromMessage(cumulusMessage);
  const pdrName = getMessagePdrName(cumulusMessage);
  const queryFields = getGranuleQueryFields(cumulusMessage);

  // Process each granule in a separate transaction via Promise.allSettled
  // so that they can succeed/fail independently
  const results = await Promise.allSettled(granules.map(
    (granule) => writeGranule({
      collectionId,
      granule,
      processingTimeInfo,
      error,
      executionUrl,
      pdrName,
      provider,
      workflowStartTime,
      workflowStatus,
      queryFields,
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
  getGranuleCumulusIdFromQueryResultOrLookup,
  writeFilesViaTransaction,
  writeGranuleAndFilesViaTransaction,
  writeGranules,
};

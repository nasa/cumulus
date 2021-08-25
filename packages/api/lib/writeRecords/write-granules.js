'use strict';

const AggregateError = require('aggregate-error');
const isEmpty = require('lodash/isEmpty');
const pMap = require('p-map');

const { s3 } = require('@cumulus/aws-client/services');
const CmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
  translateApiFiletoPostgresFile,
  FilePgModel,
  GranulePgModel,
  upsertGranuleWithExecutionJoinRecord,
  getKnexClient,
} = require('@cumulus/db');
const Logger = require('@cumulus/logger');
const { getCollectionIdFromMessage, deconstructCollectionId } = require('@cumulus/message/Collections');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');
const {
  getMessageGranules,
  getGranuleStatus,
  getGranuleQueryFields,
  messageHasGranules,
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

const FileUtils = require('../FileUtils');
const {
  getExecutionProcessingTimeInfo,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getGranuleProductVolume,
} = require('../granules');
const {
  parseException,
} = require('../utils');
const Granule = require('../../models/granules');
const {
  getCollectionCumulusId,
  getExecutionCumulusId,
  getProviderCumulusId,
} = require('./utils');

const log = new Logger({ sender: '@cumulus/api/lib/writeRecords/write-granules' });

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
const generatePostgresGranuleRecord = async ({
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
  timeToArchive,
  timeToPreprocess,
  productVolume,
  duration,
  status,
}) => {
  const {
    granuleId,
    cmrLink,
    published = false,
  } = granule;

  const temporalInfo = await cmrUtils.getGranuleTemporalInfo(granule);

  return {
    granule_id: granuleId,
    status,
    cmr_link: cmrLink,
    error,
    published,
    created_at: new Date(workflowStartTime),
    updated_at: new Date(updatedAt),
    timestamp: new Date(timestamp),
    duration,
    product_volume: productVolume,
    time_to_process: timeToPreprocess,
    time_to_archive: timeToArchive,
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
const generateFilePgRecord = ({ file, granuleCumulusId }) => ({
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
const _generateFilePgRecords = ({
  files,
  granuleCumulusId,
}) => files.map((file) => generateFilePgRecord({ file, granuleCumulusId }));

/**
 * Write an array of file records to the database
 *
 * @param {Object} params
 * @param {Object} params.fileRecords - File objects
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {Object} params.filePgModel - Optional File model override
 * @returns {Promise} - Promise resolved once all file upserts resolve
 */
const _writeFiles = async ({
  fileRecords,
  knex,
  filePgModel = new FilePgModel(),
}) => await pMap(
  fileRecords,
  async (fileRecord) => {
    log.info('About to write file record to PostgreSQL: %j', fileRecord);
    await filePgModel.upsert(knex, fileRecord);
    log.info('Successfully wrote file record to PostgreSQL: %j', fileRecord);
  },
  { stopOnError: false }
);

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

/**
 * Write a granule to PostgreSQL
 *
 * @param {Object} params
 * @param {Object} params.granule - An API granule object
 * @param {Object} params.processingTimeInfo
 *   Processing time information for the granule, if any
 * @param {Object} params.error - Workflow error, if any
 * @param {string} params.workflowStartTime - Workflow start time
 * @param {string} params.workflowStatus - Workflow status
 * @param {Object} params.queryFields - Arbitrary query fields for the granule
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message, if any
 * @param {string} params.providerCumulusId
 *   Cumulus ID for provider referenced in workflow message, if any
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {string} params.pdrCumulusId
 *   Cumulus ID for PDR referenced in workflow message, if any
 * @param {Knex.transaction} params.trx - Transaction to interact with PostgreSQL database
 * @param {string} params.updatedAt - Update timestamp
 * @param {Array} params.files - List of files to add to Dynamo Granule
 * TODO [MHS, 08/24/2021] Update Params
 *
 * @returns {Promise<number>} - Cumulus ID from PostgreSQL
 * @throws
 */
const _writePostgresGranuleViaTransaction = async ({
  granule,
  processingTimeInfo,
  error,
  workflowStartTime,
  workflowStatus,
  queryFields,
  collectionCumulusId,
  providerCumulusId,
  executionCumulusId,
  pdrCumulusId,
  trx,
  updatedAt,
  files,
  timeToArchive,
  timeToPreprocess,
  productVolume,
  duration,
  status,
}) => {
  const granuleRecord = await generatePostgresGranuleRecord({
    error,
    granule,
    files,
    workflowStartTime,
    workflowStatus,
    queryFields,
    collectionCumulusId,
    providerCumulusId,
    pdrCumulusId,
    processingTimeInfo,
    updatedAt,
    timeToArchive,
    timeToPreprocess,
    productVolume,
    duration,
    status,
  });

  log.info(`About to write granule with granuleId ${granuleRecord.granule_id}, collection_cumulus_id ${collectionCumulusId} to PostgreSQL`);

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

  log.info(`
    Successfully wrote granule with granuleId ${granuleRecord.granule_id}, collection_cumulus_id ${collectionCumulusId}
    to granule record with cumulus_id ${granuleCumulusId} in PostgreSQL
  `);
  return granuleCumulusId;
};

/**
 * Generate file records based on workflow status, write files to
 * the database, and update granule status if file writes fail
 *
 * @param {Object} params
 * @param {Object} params.files - File objects
 * @param {number} params.granuleCumulusId - Cumulus ID of the granule for this file
 * @param {string} params.granule - Granule from the payload
 * @param {Object} params.workflowError - Error from the workflow
 * @param {string} params.workflowStatus - Workflow status
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {Object} [params.granuleModel] - Optional Granule DDB model override
 * @param {Object} [params.granulePgModel] - Optional Granule PG model override
 * @returns {undefined}
 */
const _writeGranuleFiles = async ({
  files,
  granuleCumulusId,
  granule,
  workflowError,
  workflowStatus,
  knex,
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
}) => {
  let fileRecords = [];

  if (workflowStatus !== 'running') {
    fileRecords = _generateFilePgRecords({
      files: files,
      granuleCumulusId,
    });
  }

  try {
    await _writeFiles({
      fileRecords,
      knex,
    });
  } catch (error) {
    if (!isEmpty(workflowError)) {
      log.error(`Logging existing error encountered by granule ${granule.granuleId} before overwrite`, workflowError);
    }
    log.error('Failed writing files to PostgreSQL, updating granule with error', error);
    const errorObject = {
      Error: 'Failed writing files to PostgreSQL.',
      Cause: error.toString(),
    };
    await knex.transaction(async (trx) => {
      await granulePgModel.update(
        trx,
        { cumulus_id: granuleCumulusId },
        {
          status: 'failed',
          error: errorObject,
        }
      ).catch((updateError) => {
        log.fatal('Failed to update PostgreSQL granule status on file write failure!', updateError);
        throw updateError;
      });

      await granuleModel.update(
        { granuleId: granule.granuleId },
        {
          status: 'failed',
          error: errorObject,
        }
      ).catch((updateError) => {
        log.fatal('Failed to update DynamoDb granule status on file write failure!', updateError);
        throw updateError;
      });
    });
  }
};

/**
 * Transform granule files to latest file API structure
 *
 * @param {Object} params
 * @param {Object} params.granule - An API granule object
 * @param {Object} params.provider - An API provider object
 *
* @returns {Promise<Array>} - A list of file objects once resolved
 */
const _generateFilesFromGranule = async ({
  granule,
  provider,
}) => {
  const { files = [] } = granule;
  // This is necessary to set properties like
  // `key`, which is required for the PostgreSQL schema. And
  // `size` which is used to calculate the granule product
  // volume
  return await FileUtils.buildDatabaseFiles({
    s3: s3(),
    providerURL: buildURL(provider),
    files,
  });
};

/**
 * Write a granule to DynamoDB and PostgreSQL
 *
 * @param {Object} params
 * @param {string} params.collectionId - Collection ID for the workflow
 * @param {Object} params.granule - An API granule object
 * @param {Object} params.provider - Provider object
 * @param {string} params.workflowStatus - Workflow status
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
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
const _writeGranule = async ({
  collectionId,
  granule,
  files=[],
  pdrName,
  provider,
  workflowStartTime,
  workflowStatus,
  timeToArchive,
  timeToPreprocess,
  productVolume,
  duration,
  status,
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
}) => {

  let granuleCumulusId;
  await knex.transaction(async (trx) => {
    granuleCumulusId = await _writePostgresGranuleViaTransaction({
      granule,
      processingTimeInfo,
      error,
      provider,
      workflowStartTime,
      workflowStatus,
      timeToArchive,
      timeToPreprocess,
      productVolume,
      duration,
      status,
      queryFields,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId,
      pdrCumulusId,
      trx,
      updatedAt,
      files,
    });

    const dynamoGranuleRecord = await granuleModel.generateGranuleRecord({
      granule,
      executionUrl,
      collectionId,
      provider,
      workflowStartTime,
      files,
      error,
      pdrName,
      workflowStatus,
      timeToArchive,
      timeToPreprocess,
      productVolume,
      duration,
      status,
      processingTimeInfo,
      queryFields,
      updatedAt,
    });
    return granuleModel.storeGranule(dynamoGranuleRecord);
  });

  await _writeGranuleFiles({
    files,
    granuleCumulusId,
    granule,
    workflowError: error,
    workflowStatus,
    knex,
    granuleModel,
  });
};

/**
 * Thin wrapper to _writeGranule used by endpoints/granule to create a granule
 * directly.
 *
 * @param {Object} body
 * @param {string} body.collectionId, - Cumulus collection id "{name}___{version}"
 * @param {Object} [body.error = {}] - Error object to write
 * @param {strung} [body.executionUrl = unknown] - Url of execution to associate with this granule.
 * @param {Object} body.granule - cumulus granule Object
 * @param {Object} [body.granuleModel = new Granule()] - Only used for testing,
 *                  do not provide a value in your call.
 * @param {integer} [body.pdrCumulusId = unknown] - PostgreSQL cumulus_Id of a
 *                   PDR to associate with the granule.
 * @param {string} [body.pdrName = unknown] -  Name of pdr to assocate with the granule.
 * @param {Object} [body.processingTimeInfo = {}]
 * @param {Object} [body.processingTimeInfo.processingStartDateTime=unknown] - IsoString
 *                  formatted date represting the beginning of the processing
 *                  for the granule.
 * @param {Object} [body.processingTimeInfo.processingStopDateTime=unknown] - IsoString
 *                  formatted date represting the ending of the processing
 *                  for the granule.
 * @param {Object} body.provider - Valid Cumulus message Provider.
 * @param {Object} [body.queryFields = {}]
 * @param {number} [body.workflowStartTime = new Date().valueOf()] Workflow
 *                  start time numeric representation.
 * @param {string} [body.workflowStatus = "completed"] The workflow status, one
 *                  of ['running', 'failed', 'completed']
 * @returns {Promise<>}
 */
const writeGranuleFromApi = async ({
  granuleId,
  collectionId,
  status,
  execution,
  cmrLink,
  published,
  pdrName,
  provider ,
  error = {},
  createdAt = new Date().toISOString(),
  timestamp,
  updatedAt = new Date().toISOString(),
  duration,
  productVolume,
  timeToPreprocess,
  timeToArchive,
  files = [ ],
  beginningDateTime,
  endingDateTime,
  productionDateTime,
  lastUpdateDateTime,
  processingStartDateTime,
  processingEndDateTime,
}) => {

  try {
    const knex = await getKnexClient();

    const collectionNameVersion = deconstructCollectionId(collectionId);
    const collectionCumulusId = await getCollectionCumulusId(collectionNameVersion, knex);
    const providerCumulusId = await getProviderCumulusId(provider.id, knex);
    const executionCumulusId = await getExecutionCumulusId(execution, knex);



    const result = await _writeGranule({
      collectionCumulusId,
      collectionId,
      error,
      executionCumulusId,
      executionUrl,
      granule,
      granuleModel,
      knex,
      pdrCumulusId,
      pdrName,
      processingTimeInfo,
      provider,
      providerCumulusId,
      queryFields,
      workflowStartTime,
      workflowStatus,
    });
    if (result && result.status === 'rejected') {
      const theError = new Error(result.reason);
      log.error('Failed to _writeGranule', theError);
      throw theError;
    }
    return `Wrote Granule ${granule.granuleId}`;
  } catch (outerError) {
    log.error('Failed to write granule', outerError);
    throw error;
  }
};

/**
 * Write granules to DynamoDB and PostgreSQL
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message, if any
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
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
const writeGranulesFromMessage = async ({
  cumulusMessage,
  collectionCumulusId,
  executionCumulusId,
  knex,
  providerCumulusId,
  pdrCumulusId,
  granuleModel = new Granule(),
}) => {
  if (!messageHasGranules(cumulusMessage)) {
    log.info('No granules to write, skipping writeGranules');
    return undefined;
  }
  if (!collectionCumulusId) {
    throw new Error('Collection reference is required for granules');
  }

  const granules = getMessageGranules(cumulusMessage);
  const granuleIds = granules.map((granule) => granule.granuleId);
  log.info(`process granule IDs ${granuleIds.join(',')}`);

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
    async (granule) => {
      // compute granule specific data.
      const files = await _generateFilesFromGranule({ granule, provider });
      const timeToArchive = getGranuleTimeToArchive(granule);
      const timeToPreprocess = getGranuleTimeToPreprocess(granule);
      const productVolume = getGranuleProductVolume(files);
      const now = Date.now(); // yank me
      const duration = getWorkflowDuration(workflowStartTime, now);
      const status = getGranuleStatus(workflowStatus, granule);
      // const postgresGranuleRecord = buildGranuleRecord({stuff});
      // const dynamoGranuleRecord = granuleModel.buildRecord({stuff})
      // return _writeGranule({dynamoGranuleRecord, postgresGranuleRecord, knex, granuleModel});
      return _writeGranule({
        collectionId,
        granule,
        files,
        processingTimeInfo,
        error,
        executionUrl,
        pdrName,
        provider,
        workflowStartTime,
        workflowStatus,
        timeToArchive,
        timeToPreprocess,
        productVolume,
        duration,
        status,
        queryFields,
        collectionCumulusId,
        providerCumulusId,
        executionCumulusId,
        pdrCumulusId,
        knex,
        granuleModel,
      });
    }
  ));

  log.debug(`results: ${JSON.stringify(results)}`);
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
  generateFilePgRecord,
  generatePostgresGranuleRecord,
  getGranuleCumulusIdFromQueryResultOrLookup,
  writeGranuleFromApi,
  writeGranulesFromMessage,
};

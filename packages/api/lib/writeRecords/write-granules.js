'use strict';

const AggregateError = require('aggregate-error');
const isEmpty = require('lodash/isEmpty');
const pMap = require('p-map');

const { s3 } = require('@cumulus/aws-client/services');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
  translateApiFiletoPostgresFile,
  FilePgModel,
  GranulePgModel,
  upsertGranuleWithExecutionJoinRecord,
  getKnexClient,
  translateApiGranuleToPostgresGranule,
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
} = require('./utils');

const log = new Logger({ sender: '@cumulus/api/lib/writeRecords/write-granules' });

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
  granuleRecord,
  collectionCumulusId,
  executionCumulusId,
  trx,
}) => {
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
  granuleId,
  workflowError,
  status,
  knex,
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
}) => {
  let fileRecords = [];

  if (status !== 'running') {
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
      log.error(`Logging existing error encountered by granule ${granuleId} before overwrite`, workflowError);
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
        { granuleId },
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
  postgisGranuleRecord,
  dynamoGranuleRecord,
  collectionCumulusId,
  executionCumulusId,
  knex,
  granuleModel = new Granule(),
}) => {
  let granuleCumulusId;
  await knex.transaction(async (trx) => {
    granuleCumulusId = await _writePostgresGranuleViaTransaction({
      granuleRecord: postgisGranuleRecord,
      collectionCumulusId,
      executionCumulusId,
      trx,
    });
    return granuleModel.storeGranule(dynamoGranuleRecord);
  });

  const { files, granuleId, status, error } = dynamoGranuleRecord;
  await _writeGranuleFiles({
    files,
    granuleCumulusId,
    granuleId,
    workflowError: error,
    status,
    knex,
    granuleModel,
  });
};

/**
 * Thin wrapper to _writeGranule used by endpoints/granule to create a granule
 * directly.
 *
 * @param {Object} body
 * @param {string} granuleId -
 * @param {string} collectionId -
 * @param {GranuleStatus} status -
 * @param {string} [execution] - Execution URL to associate with this granule must already exist in database.
 * @param {string} [cmrLink] - url to CMR information for this granule.
 * @param {boolean} [published] - published to cmr
 * @param {string} [pdrName] -
 * @param {string} [provider] -
 * @param {Object} [error] = {} -
 * @param {string} [createdAt] = new Date().toISOString() -
 * @param {string} [timestamp] -
 * @param {string} [updatedAt] = new Date().toISOString() -
 * @param {number} [duration] - seconds
 * @param {integer} [productVolume] - sum of the files sizes in bytes
 * @param {integer} [timeToPreprocess] -  seconds
 * @param {integer} [timeToArchive] - seconds
 * @param {Array<ApiFile>} files - files associated with the granule.
 * @param {string} [beginningDateTime] - CMR Echo10: Temporal.RangeDateTime.BeginningDateTime
 * @param {string} [endingDateTime] - CMR Echo10: Temporal.RangeDateTime.EndingDateTime
 * @param {string} [productionDateTime] - CMR Echo10: DataGranule.ProductionDateTime
 * @param {string} [lastUpdateDateTime] - CMR Echo10: LastUpdate || InsertTime
 * @param {string} [processingStartDateTime] - execution startDate
 * @param {string} [processingEndDateTime] - execution StopDate
 * @param {Object} [queryFields] - query fields
 * @param {Object} [granuleModel] - only used for testing.
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
  provider,
  error = {},
  createdAt = new Date().valueOf(),
  updatedAt = new Date().valueOf(),
  duration,
  productVolume,
  timeToPreprocess,
  timeToArchive,
  files = [],
  beginningDateTime,
  endingDateTime,
  productionDateTime,
  lastUpdateDateTime,
  processingStartDateTime,
  processingEndDateTime,
  queryFields,
  granuleModel = new Granule(),
}) => {
  try {
    const knex = await getKnexClient();

    // Build a objects with correct shape for the granuleModel.generateGranuleRecord.
    const granule = {
      granuleId,
      cmrLink,
      published,
      files,
    };
    const processingTimeInfo = {
      processingStartDateTime,
      processingEndDateTime,
    };
    const cmrTemporalInfo = {
      beginningDateTime, // - from cmr
      endingDateTime,
      productionDateTime,
      lastUpdateDateTime,
    };

    const collectionNameVersion = deconstructCollectionId(collectionId);

    const collectionCumulusId = await getCollectionCumulusId(collectionNameVersion, knex);
    let executionCumulusId;
    if (execution !== undefined) {
      executionCumulusId = await getExecutionCumulusId(execution, knex);
    }

    log.debug('about to geneate dynamo granule ');
    const dynamoGranuleRecord = await granuleModel.generateGranuleRecord({
      granule,
      executionUrl: execution,
      collectionId,
      provider,
      timeToArchive,
      timeToPreprocess,
      productVolume,
      duration,
      status,
      workflowStartTime: createdAt,
      files,
      error,
      pdrName,
      queryFields,
      processingTimeInfo,
      updatedAt,
      cmrTemporalInfo,
    });

    log.debug(`dynamoGranuleRecord: ${JSON.stringify(dynamoGranuleRecord)}`);

    const postgisGranuleRecord = await translateApiGranuleToPostgresGranule(
      dynamoGranuleRecord,
      knex
    );

    log.debug(`postgisGranuleRecord ${JSON.stringify(postgisGranuleRecord)}`);

    const result = await _writeGranule({
      postgisGranuleRecord,
      dynamoGranuleRecord,
      collectionCumulusId,
      executionCumulusId,
      knex,
      granuleModel,

    });
    if (result && result.status === 'rejected') {
      const theError = new Error(result.reason);
      log.error('Failed to _writeGranule', theError);
      throw theError;
    }
    return `Wrote Granule ${granule.granuleId}`;
  } catch (thrownError) {
    log.error('Failed to write granule', thrownError);
    throw thrownError;
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
// TODO [MHS, 08/26/2021] update this.
 * @throws {Error}
 */
const writeGranulesFromMessage = async ({
  cumulusMessage,
  collectionCumulusId,
  executionCumulusId,
  knex,
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
      const updatedAt = Date.now();

      const dynamoGranuleRecord = await granuleModel.generateGranuleRecord({
        granule,
        executionUrl,
        collectionId,
        provider: provider.id,
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

      const postgisGranuleRecord = await translateApiGranuleToPostgresGranule(
        dynamoGranuleRecord,
        knex
      );

      return/*?*/ _writeGranule({
        postgisGranuleRecord,
        dynamoGranuleRecord,
        collectionCumulusId,
        executionCumulusId,
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
  getGranuleCumulusIdFromQueryResultOrLookup,
  writeGranuleFromApi,
  writeGranulesFromMessage,
};

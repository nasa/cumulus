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
  translateApiGranuleToPostgresGranule,
  CollectionPgModel,
  createRejectableTransaction,
} = require('@cumulus/db');
const Logger = require('@cumulus/logger');
const {
  deconstructCollectionId,
  getCollectionIdFromMessage,
} = require('@cumulus/message/Collections');
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
  getExecutionCumulusId,
  isStatusFinalState,
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
 * @param {Object} params.granuleRecord - An postgres granule records
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex.transaction} params.trx - Transaction to interact with PostgreSQL database
 * @param {Object} params.granulePgModel - postgreSQL granule model
 *
 * @returns {Promise<number>} - Cumulus ID from PostgreSQL
 * @throws
 */
const _writePostgresGranuleViaTransaction = async ({
  granuleRecord,
  executionCumulusId,
  trx,
  granulePgModel,
}) => {
  const upsertQueryResult = await upsertGranuleWithExecutionJoinRecord(
    trx,
    granuleRecord,
    executionCumulusId,
    granulePgModel
  );
  // Ensure that we get a granule ID for the files even if the
  // upsert query returned an empty result
  const granuleCumulusId = await getGranuleCumulusIdFromQueryResultOrLookup({
    trx,
    queryResult: upsertQueryResult,
    granuleRecord,
  });

  return granuleCumulusId;
};

/**
 * Update granule status
 *
 * @param {Object} params
 * @param {number} params.granuleCumulusId - Cumulus ID of a granule
 * @param {string} params.granuleId - granule ID from the payload
 * @param {Knex} params.knex - knex Client
 * @param {string} params.status - new status for granule
 * @returns {Promise}
 * @throws {Error}
 */
async function updateGranuleStatus({
  granule,
  knex,
  status,
  error = '',
  errorCause = '',
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
  collectionPgModel = new CollectionPgModel(),
}) {
  const { granuleId, collectionId } = granule;
  const errorObject = error && errorCause
    ? {
      Error: error,
      Cause: errorCause,
    }
    : {};
  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(collectionId)
    );
    const granuleCumulusId = await granulePgModel.getRecordCumulusId(
      knex,
      {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );

    await createRejectableTransaction(knex, async (trx) => {
      await granulePgModel.update(
        trx,
        { cumulus_id: granuleCumulusId },
        {
          status,
          error: errorObject,
        }
      );
      // delete the execution field as well
      await granuleModel.update(
        { granuleId },
        {
          status,
          error: errorObject,
        },
        ['execution']
      );
    });

    log.debug(`Updated granule status to ${status}, Dynamo granuleId: ${granuleId}, PostgreSQL cumulus_id: ${granuleCumulusId}`);
  } catch (thrownError) {
    log.error(`Failed to update granule status to ${status}, granuleId: ${granuleId}`, thrownError);
    throw thrownError;
  }
}

/**
 * Update granule status to 'failed'
 *
 * @param {Object} params
 * @param {Object} params.granuleCumulusId - Cumulus ID of the granule
 * @param {Object} params.granuleId - dynamo granule object
 * @param {Knex} params.knex - knex Client
 * @returns {Promise}
 * @throws {Error}
 */
async function updateGranuleStatusToFailed({
  granule,
  knex,
  error,
  errorCause,
}) {
  const status = 'failed';
  const { granuleId, collectionId } = granule;
  log.info(`updateGranuleStatusToFailed(): granuleId: ${granuleId}, collectionId: ${collectionId}`);

  await updateGranuleStatus({
    granule,
    knex,
    status,
    error,
    errorCause,
  });
}

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
  status,
  knex,
}) => {
  let fileRecords = [];
  const { granuleId } = granule;
  if (isStatusFinalState(status)) {
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
    await updateGranuleStatusToFailed({
      granule,
      knex,
      error: 'Failed writing files to PostgreSQL.',
      errorCause: error.toString(),
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
 * Write a granule record to DynamoDB and PostgreSQL
 * param {PostgresGranule} postgresGranuleRecord,
 * param {DynamoDBGranule} dynamoGranuleRecord,
 * param {number} executionCumulusId,
 * param {Knex} knex,
 * param {Object} granuleModel = new Granule(),
 * returns {Promise}
 * throws
 */
const _writeGranule = async ({
  postgresGranuleRecord,
  dynamoGranuleRecord,
  executionCumulusId,
  knex,
  granuleModel,
  granulePgModel,
}) => {
  let granuleCumulusId;

  log.info('About to write granule record %j to PostgreSQL', postgresGranuleRecord);
  log.info('About to write granule record %j to DynamoDB', dynamoGranuleRecord);

  try {
    await createRejectableTransaction(knex, async (trx) => {
      granuleCumulusId = await _writePostgresGranuleViaTransaction({
        granuleRecord: postgresGranuleRecord,
        executionCumulusId,
        trx,
        granulePgModel,
      });
      return granuleModel.storeGranule(dynamoGranuleRecord);
    });
  } catch (thrownError) {
    log.error(`Write Granule failed: ${JSON.stringify(thrownError)}`);

    if (isStatusFinalState(postgresGranuleRecord.status)
      && isStatusFinalState(dynamoGranuleRecord.status)
      && thrownError.name === 'SchemaValidationError') {
      const originalError = dynamoGranuleRecord.error || undefined;
      const errorMsgWithOriginalError = `${thrownError.toString()} ${originalError.Error ? ` -  ${JSON.stringify(originalError)}` : ''}`;
      await updateGranuleStatusToFailed({
        granule: dynamoGranuleRecord,
        knex,
        error: 'Write Granule Failed',
        errorCause: errorMsgWithOriginalError,
      });
    }
    throw thrownError;
  }

  log.info(
    `
    Successfully wrote granule %j to PostgreSQL. Record cumulus_id in PostgreSQL: ${granuleCumulusId}.
    `,
    postgresGranuleRecord
  );
  log.info('Successfully wrote granule %j to DynamoDB', dynamoGranuleRecord);

  const { files, status, error } = dynamoGranuleRecord;

  await _writeGranuleFiles({
    files,
    granuleCumulusId,
    granule: dynamoGranuleRecord,
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
 * @param {Object} params
 * @param {string} params.granuleId - granule's id
 * @param {string} params.collectionId - granule's collection id
 * @param {GranuleStatus} params.status - ['running','failed','completed', 'queued']
 * @param {string} [params.execution] - Execution URL to associate with this granule
 *                               must already exist in database.
 * @param {string} [params.cmrLink] - url to CMR information for this granule.
 * @param {boolean} [params.published] - published to cmr
 * @param {string} [params.pdrName] - pdr name
 * @param {string} [params.provider] - provider
 * @param {Object} [params.error = {}] - workflow errors
 * @param {string} [params.createdAt = new Date().valueOf()] - time value
 * @param {string} [params.timestamp] - timestamp
 * @param {string} [params.updatedAt = new Date().valueOf()] - time value
 * @param {number} [params.duration] - seconds
 * @param {integer} [params.productVolume] - sum of the files sizes in bytes
 * @param {integer} [params.timeToPreprocess] -  seconds
 * @param {integer} [params.timeToArchive] - seconds
 * @param {Array<ApiFile>} params.files - files associated with the granule.
 * @param {string} [params.beginningDateTime] - CMR Echo10: Temporal.RangeDateTime.BeginningDateTime
 * @param {string} [params.endingDateTime] - CMR Echo10: Temporal.RangeDateTime.EndingDateTime
 * @param {string} [params.productionDateTime] - CMR Echo10: DataGranule.ProductionDateTime
 * @param {string} [params.lastUpdateDateTime] - CMR Echo10: LastUpdate || InsertTime
 * @param {string} [params.processingStartDateTime] - execution startDate
 * @param {string} [params.processingEndDateTime] - execution StopDate
 * @param {Object} [params.queryFields] - query fields
 * @param {Object} [params.granuleModel] - only for testing.
 * @param {Object} [params.granulePgModel] - only for testing.
 * @param {Knex} knex - knex Client
 * @returns {Promise}
 */
const writeGranuleFromApi = async (
  {
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
    timestamp,
    files = [],
    beginningDateTime,
    endingDateTime,
    productionDateTime,
    lastUpdateDateTime,
    processingStartDateTime,
    processingEndDateTime,
    queryFields,
    granuleModel = new Granule(),
    granulePgModel = new GranulePgModel(),
  },
  knex
) => {
  try {
    // Build a objects with correct shape for the granuleModel.generateGranuleRecord.
    const granule = { granuleId, cmrLink, published, files };
    const processingTimeInfo = {
      processingStartDateTime,
      processingEndDateTime,
    };
    const cmrTemporalInfo = {
      beginningDateTime,
      endingDateTime,
      productionDateTime,
      lastUpdateDateTime,
    };

    let executionCumulusId;
    if (execution) {
      executionCumulusId = await getExecutionCumulusId(execution, knex);
      if (executionCumulusId === undefined) {
        throw new Error(`Could not find execution in PostgreSQL database with url ${execution}`);
      }
    }

    const dynamoGranuleRecord = await granuleModel.generateGranuleRecord({
      granule,
      executionUrl: execution,
      collectionId,
      provider,
      timeToArchive,
      timeToPreprocess,
      timestamp,
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

    const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
      dynamoGranuleRecord,
      knex
    );

    await _writeGranule({
      postgresGranuleRecord,
      dynamoGranuleRecord,
      executionCumulusId,
      knex,
      granuleModel,
      granulePgModel,
    });
    return `Wrote Granule ${granule.granuleId}`;
  } catch (thrownError) {
    log.error('Failed to write granule', thrownError);
    throw thrownError;
  }
};

/**
 * Write granules from a cumulus message to DynamoDB and PostgreSQL
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {Object} [params.granuleModel]
 *   Optional override for the granule model writing to DynamoDB
 * @param {Object} [params.granulePgModel]
 *   Optional override for the granule model writing to PostgreSQL database
 * @returns {Promise<Object[]>}
 *  true if there are no granules on the message, otherwise
 *  results from Promise.allSettled for all granules
 * @throws {Error}
 */
const writeGranulesFromMessage = async ({
  cumulusMessage,
  executionCumulusId,
  knex,
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
}) => {
  if (!messageHasGranules(cumulusMessage)) {
    log.info('No granules to write, skipping writeGranules');
    return undefined;
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
      const now = Date.now();
      const duration = getWorkflowDuration(workflowStartTime, now);
      const status = getGranuleStatus(workflowStatus, granule);
      const updatedAt = now;

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

      const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
        dynamoGranuleRecord,
        knex
      );

      return _writeGranule({
        postgresGranuleRecord,
        dynamoGranuleRecord,
        executionCumulusId,
        knex,
        granuleModel,
        granulePgModel,
      });
    }
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

/**
 * Update granule status to 'queued'
 *
 * @param {Object} params
 * @param {Object} params.granule - dynamo granule object
 * @param {Knex} params.knex - knex Client
 * @returns {Promise}
 * @throws {Error}
 */
async function updateGranuleStatusToQueued({
  granule,
  knex,
}) {
  const { granuleId, collectionId } = granule;
  const status = 'queued';
  log.info(`updateGranuleStatusToQueued granuleId: ${granuleId}, collectionId: ${collectionId}`);

  await updateGranuleStatus({
    granule,
    knex,
    status,
  });
}

module.exports = {
  generateFilePgRecord,
  getGranuleCumulusIdFromQueryResultOrLookup,
  updateGranuleStatus,
  updateGranuleStatusToQueued,
  updateGranuleStatusToFailed,
  writeGranuleFromApi,
  writeGranulesFromMessage,
};

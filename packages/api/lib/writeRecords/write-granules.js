'use strict';

const AggregateError = require('aggregate-error');
const isEmpty = require('lodash/isEmpty');
const pMap = require('p-map');

const { s3 } = require('@cumulus/aws-client/services');
const cmrUtils = require('@cumulus/cmrjs/cmr-utils');
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
const {
  upsertGranule,
} = require('@cumulus/es-client/indexer');
const {
  Search,
} = require('@cumulus/es-client/search');
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
  generateGranuleApiRecord,
  getGranuleProductVolume,
  getGranuleQueryFields,
  getGranuleStatus,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getMessageGranules,
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
const { parseException } = require('@cumulus/message/utils');
const { translatePostgresGranuleToApiGranule } = require('@cumulus/db/dist/translate/granules');

const FileUtils = require('../FileUtils');
const {
  getExecutionProcessingTimeInfo,
} = require('../granules');
const Granule = require('../../models/granules');
const {
  publishGranuleSnsMessageByEventType,
} = require('../publishSnsMessageUtils');
const {
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
    const [upsertedRecord] = await filePgModel.upsert(knex, fileRecord);
    log.info('Successfully wrote file record to PostgreSQL: %j', fileRecord);
    return upsertedRecord;
  },
  { stopOnError: false }
);

/**
 * Get the granule from a query result or look it up in the database.
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
 * @returns {Promise<Object|undefined>} - Granule record
 */
const getGranuleFromQueryResultOrLookup = async ({
  queryResult = [],
  granuleRecord,
  trx,
  granulePgModel = new GranulePgModel(),
}) => {
  let granule = queryResult[0];
  if (!granule) {
    granule = await granulePgModel.get(
      trx,
      {
        granule_id: granuleRecord.granule_id,
        collection_cumulus_id: granuleRecord.collection_cumulus_id,
      }
    );
  }
  return granule;
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
  // Ensure that we get a granule for the files even if the
  // upsert query returned an empty result
  const pgGranule = await getGranuleFromQueryResultOrLookup({
    trx,
    queryResult: upsertQueryResult,
    granuleRecord,
  });

  log.info(`
    Successfully wrote granule with granuleId ${granuleRecord.granule_id}, collection_cumulus_id ${granuleRecord.collection_cumulus_id}
    to granule record with cumulus_id ${pgGranule.cumulus_id} in PostgreSQL
  `);
  return pgGranule;
};

const _removeExcessFiles = async ({
  filePgModel = new FilePgModel(),
  writtenFiles,
  granuleCumulusId,
  knex, // TODO Refactor
}) => {
  if (writtenFiles.length === 0) {
    throw new Error('_removeExcessFiles called with no written files');
  }
  const excludeList = writtenFiles.map((file) => file.cumulus_id);
  return await filePgModel.deleteExcluding({
    knexOrTransaction: knex,
    queryParams: { cumulus_id: granuleCumulusId },
    excludeList,
  });
};

/**
 * Generate file records based on workflow status, write files to
 * the database, and update granule status if file writes fail
 *
 * @param {Object} params
 * @param {Object} [params.files] - File objects
 * @param {number} params.granuleCumulusId - Cumulus ID of the granule for this file
 * @param {string} params.granule - Granule from the payload
 * @param {Object} params.workflowError - Error from the workflow
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {string} params.snsEventType - SNS Event Type
 * @param {Object} [params.granuleModel] - Optional Granule DDB model override
 * @param {Object} [params.granulePgModel] - Optional Granule PG model override
 * @returns {undefined}
 */
const _writeGranuleFiles = async ({
  files,
  granuleCumulusId,
  granuleId,
  workflowError,
  knex,
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
}) => {
  const fileRecords = _generateFilePgRecords({
    files,
    granuleCumulusId,
  });
  try {
    const writtenFiles = await _writeFiles({
      fileRecords,
      knex,
    });
    await _removeExcessFiles({
      writtenFiles,
      granuleCumulusId,
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
    await createRejectableTransaction(knex, async (trx) => {
      await granulePgModel.update(
        trx,
        { cumulus_id: granuleCumulusId },
        {
          status: 'failed',
          error: errorObject,
        },
        ['*']
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

const writeGranuleToDynamoAndEs = async (params) => {
  const {
    apiGranuleRecord,
    granuleModel,
    esClient = await Search.es(),
  } = params;
  try {
    await granuleModel.storeGranule(apiGranuleRecord);
    await upsertGranule({
      esClient,
      updates: apiGranuleRecord,
      index: process.env.ES_INDEX,
    });
  } catch (writeError) {
    log.info(`Writes to DynamoDB/Elasticsearch failed, rolling back all writes for granule ${apiGranuleRecord.granuleId}`);
    // On error, delete the Dynamo record to ensure that all systems
    // stay in sync
    await granuleModel.delete({
      granuleId: apiGranuleRecord.granuleId,
      collectionId: apiGranuleRecord.collectionId,
    });
    throw writeError;
  }
};

/**
 * Write a granule record to DynamoDB and PostgreSQL
 *
 * @param {Object} params
 * @param {DynamoDBGranule} params.apiGranuleRecord,
 * @param {number}          params.executionCumulusId,
 * @param {Object}          params.esClient - Elasticsearch client
 * @param {Object}          params.granuleModel - Instance of DynamoDB granule model
 * @param {Object}          params.granulePgModel,
 * @param {Knex}            params.knex,
 * @param {PostgresGranule} params.postgresGranuleRecord,
 * @param {string}          params.snsEventType - SNS Event Type
 * returns {Promise}
 * throws
 */
const _writeGranule = async ({
  postgresGranuleRecord,
  apiGranuleRecord,
  esClient,
  executionCumulusId,
  granuleModel,
  granulePgModel,
  knex,
  snsEventType,
}) => {
  let pgGranule;

  log.info('About to write granule record %j to PostgreSQL', postgresGranuleRecord);
  log.info('About to write granule record %j to DynamoDB', apiGranuleRecord);

  await createRejectableTransaction(knex, async (trx) => {
    pgGranule = await _writePostgresGranuleViaTransaction({
      granuleRecord: postgresGranuleRecord,
      executionCumulusId,
      trx,
      granulePgModel,
    });
    await writeGranuleToDynamoAndEs({
      apiGranuleRecord,
      esClient,
      granuleModel,
    });
  });

  log.info(
    `
    Successfully wrote granule %j to PostgreSQL. Record cumulus_id in PostgreSQL: ${pgGranule.cumulus_id}.
    `,
    postgresGranuleRecord
  );
  log.info('Successfully wrote granule %j to DynamoDB', apiGranuleRecord);

  const { files, granuleId, status, error } = apiGranuleRecord;

  if (status !== 'running' && status !== 'queued' && files.length > 0) {
    await _writeGranuleFiles({
      files,
      granuleCumulusId: pgGranule.cumulus_id,
      granuleId,
      workflowError: error,
      knex,
      snsEventType,
      granuleModel,
    });
  }

  const granuletoPublish = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });
  await publishGranuleSnsMessageByEventType(granuletoPublish, snsEventType);
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
 * @param {Object} esClient - Elasticsearch client
 * @param {string} snsEventType - SNS Event Type
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
  knex,
  esClient,
  snsEventType
) => {
  try {
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

    const apiGranuleRecord = await generateGranuleApiRecord({
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
      cmrUtils,
    });

    const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
      apiGranuleRecord,
      knex
    );

    await _writeGranule({
      postgresGranuleRecord,
      apiGranuleRecord,
      executionCumulusId,
      knex,
      granuleModel,
      granulePgModel,
      esClient,
      snsEventType,
    });
    return `Wrote Granule ${granule.granuleId}`;
  } catch (thrownError) {
    log.error('Failed to write granule', thrownError);
    throw thrownError;
  }
};

const createGranuleFromApi = async (granule, knex, esClient) => {
  await writeGranuleFromApi(granule, knex, esClient, 'Create');
};

const updateGranuleFromApi = async (granule, knex, esClient) => {
  await writeGranuleFromApi(granule, knex, esClient, 'Update');
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
  esClient,
}) => {
  if (!messageHasGranules(cumulusMessage)) {
    log.info('No granules to write, skipping writeGranulesFromMessage');
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

      const apiGranuleRecord = await generateGranuleApiRecord({
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
        cmrUtils,
      });

      const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
        apiGranuleRecord,
        knex
      );

      return _writeGranule({
        postgresGranuleRecord,
        apiGranuleRecord,
        executionCumulusId,
        knex,
        granuleModel,
        granulePgModel,
        esClient,
        snsEventType: 'Update',
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
  collectionPgModel = new CollectionPgModel(),
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
}) {
  const { granuleId, collectionId } = granule;
  const status = 'queued';
  log.info(`updateGranuleStatusToQueued granuleId: ${granuleId}, collectionId: ${collectionId}`);

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
      await granulePgModel.update(trx, { cumulus_id: granuleCumulusId }, { status });
      // delete the execution field as well
      await granuleModel.update({ granuleId }, { status }, ['execution']);
    });

    log.debug(`Updated granule status to queued, Dynamo granuleId: ${granule.granuleId}, PostgreSQL cumulus_id: ${granuleCumulusId}`);
  } catch (thrownError) {
    log.error(`Failed to update granule status to queued, granuleId: ${granule.granuleId}, collectionId: ${collectionId}`, thrownError);
    throw thrownError;
  }
}

module.exports = {
  _writeGranule,
  generateFilePgRecord,
  updateGranuleStatusToQueued,
  getGranuleFromQueryResultOrLookup,
  writeGranuleFromApi,
  writeGranulesFromMessage,
  createGranuleFromApi,
  updateGranuleFromApi,
};

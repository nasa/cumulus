// @ts-check

'use strict';

const AggregateError = require('aggregate-error');
const isArray = require('lodash/isArray');
const isEmpty = require('lodash/isEmpty');
const isNil = require('lodash/isNil');
const omit = require('lodash/omit');
const isNull = require('lodash/isNull');
const isObject = require('lodash/isObject');
const isString = require('lodash/isString');
const isUndefined = require('lodash/isUndefined');
const omitBy = require('lodash/omitBy');
const pMap = require('p-map');

const { s3 } = require('@cumulus/aws-client/services');
const cmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
  CollectionPgModel,
  createRejectableTransaction,
  FilePgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  getGranulesByGranuleId,
  translateApiFiletoPostgresFile,
  upsertGranuleWithExecutionJoinRecord,
  translateApiGranuleToPostgresGranuleWithoutNilsRemoved,
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

const {
  CumulusMessageError,
  GranuleFileWriteError,
} = require('@cumulus/errors');

const FileUtils = require('../FileUtils');
const {
  getExecutionProcessingTimeInfo,
} = require('../granules');

const {
  describeGranuleExecution,
} = require('../executions');

const {
  publishGranuleSnsMessageByEventType,
} = require('../publishSnsMessageUtils');
const {
  getExecutionCumulusId,
  isStatusFinalState,
} = require('./utils');

/**
* @typedef { import('knex').Knex } Knex
* @typedef { import('knex').Knex.Transaction } KnexTransaction
* @typedef { import('@cumulus/types').ApiGranule } ApiGranule
* @typedef { import('@cumulus/types').ApiGranuleRecord } ApiGranuleRecord
* @typedef {import('@cumulus/types/message').CumulusMessage} CumulusMessage
* @typedef { Granule } ApiGranuleModel
* @typedef { import('@cumulus/db').PostgresGranuleRecord } PostgresGranuleRecord
* @typedef { import('@cumulus/db').PostgresFile } PostgresFile
* @typedef { import('@cumulus/db').PostgresFileRecord } PostgresFileRecord
* @typedef { import('@cumulus/db').GranulePgModel } GranulePgModel
* @typedef { import('@cumulus/db').FilePgModel } FilePgModel
* @typedef {{ granuleId: string}} GranuleWithGranuleId
*/

const { recordIsValid } = require('../schema');
const granuleSchema = require('../schemas').granule;
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
 * @param {PostgresFile[]} params.fileRecords - File objects
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {FilePgModel} [params.filePgModel] - Optional File model override
 * @returns {Promise<PostgresFileRecord[]>} - Promise resolved once all file upserts resolve
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
 * @param {KnexTransaction} params.trx - A Knex transaction
 * @param {PostgresGranuleRecord[]} params.queryResult - Query result
 * @param {PostgresGranuleRecord} params.granuleRecord - A postgres granule record
 * @param {GranulePgModel} [params.granulePgModel] - PG Database model for granule data
 * @returns {Promise<PostgresGranuleRecord>} - PG Granule record
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
 * @param {PostgresGranuleRecord} params.granuleRecord - A postgres granule record
 * @param {number} params.executionCumulusId - Cumulus ID for execution referenced in workflow
 *                                             message, if any
 * @param {KnexTransaction} params.trx      - Transaction to interact with PostgreSQL database
 * @param {GranulePgModel} params.granulePgModel     - postgreSQL granule model
 * @param {boolean} params.writeConstraints  - Boolean flag to set if createdAt/execution write
 *                                            constraints should restrict write behavior in the
 *                                            database via upsertGranuleWithExecutionJoinRecord
 * @returns {Promise<{status:string, pgGranule:PostgresGranuleRecord}>} - Object containing status
 *                              of upsertGranuleWithExecutionJoinRecord ('succeeded' or 'dropped'),
 *                              along with the latest granule in PG, which is the result of the
 *                              upsert operation if successful
 */
const _writePostgresGranuleViaTransaction = async ({
  granuleRecord,
  executionCumulusId,
  trx,
  granulePgModel,
  writeConstraints = true,
}) => {
  const upsertQueryResult = await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: trx,
    granule: granuleRecord,
    executionCumulusId,
    granulePgModel,
    writeConstraints,
  });
  // Ensure that we get a granule for the files even if the
  // upsert query returned an empty result
  const pgGranule = await getGranuleFromQueryResultOrLookup({
    trx,
    queryResult: upsertQueryResult,
    granuleRecord,
  });

  if (!upsertQueryResult[0]) {
    log.info(`
    Did not update ${granuleRecord.granule_id}, collection_cumulus_id ${granuleRecord.collection_cumulus_id}
    due to granule overwrite constraints, retaining original granule for cumulus_id ${pgGranule.cumulus_id}`);

    return { status: 'dropped', pgGranule };
  }

  log.info(`
  Successfully wrote granule with granuleId ${granuleRecord.granule_id}, collection_cumulus_id ${granuleRecord.collection_cumulus_id}
  to granule record with cumulus_id ${pgGranule.cumulus_id} in PostgreSQL
  `);

  return { status: 'success', pgGranule };
};

/**
* Removes excess files from the postgres database for a given granule
* @summary Given a list of postgres file objects, remove all other file objects
* from the postgres database for the provided granuleCumulusId
*
* @param {Object} params
* @param {PostgresFileRecord[]} params.writtenFiles - List of postgres file objects that should
*                                                     not be removed by this method.
* @param {number} params.granuleCumulusId - postgres cumulus_id identifying
*                                           the granule to be updated
* @param {Knex} params.knex - Instance of a Knex client
* @param {FilePgModel} [params.filePgModel] - @cumulus/db compatible FilePgModel,
                                              provided for test/mocks
* @returns {Promise<number>} The number of rows deleted
*/
const _removeExcessFiles = async ({
  writtenFiles,
  granuleCumulusId,
  knex,
  filePgModel = new FilePgModel(),
}) => {
  const excludeCumulusIds = writtenFiles.map((file) => file.cumulus_id);
  return await filePgModel.deleteExcluding({
    knexOrTransaction: knex,
    queryParams: { granule_cumulus_id: granuleCumulusId },
    excludeCumulusIds,
  });
};

const _publishPostgresGranuleUpdateToSns = async ({
  snsEventType,
  pgGranule,
  knex,
}) => {
  const granuletoPublish = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });
  await publishGranuleSnsMessageByEventType(granuletoPublish, snsEventType);
  log.info('Successfully wrote granule %j to SNS topic', granuletoPublish);
};

/**
 * Update granule record status in PostgreSQL
 * Publish SNS event for updated granule.
 *
 * @param {Object}  params
 * @param {Object}  params.apiGranule            - API Granule object to write to
 *                                                 the database
 * @param {Object}  params.postgresGranule       - PostgreSQL granule
 * @param {Object}  params.apiFieldUpdates       - API fields to update
 * @param {Object}  params.pgFieldUpdates        - PostgreSQL fields to update
 * @param {Object}  params.apiFieldsToDelete     - API fields to delete
 * @param {Object}  params.granulePgModel        - @cumulus/db compatible granule module instance
 * @param {Knex}    params.knex                  - Knex object
 * @param {string}  params.snsEventType          - SNS Event Type, defaults to 'Update'
 * returns {Promise}
 */
const _updateGranule = async ({
  apiGranule,
  postgresGranule,
  pgFieldUpdates,
  granulePgModel,
  knex,
  snsEventType = 'Update',
}) => {
  const granuleId = apiGranule.granuleId;
  const [updatedPgGranule] = await granulePgModel.update(
    knex,
    { cumulus_id: postgresGranule.cumulus_id },
    pgFieldUpdates,
    ['*']
  );
  log.info(`Successfully wrote granule ${granuleId} to PostgreSQL`);
  log.info(
    `
    Successfully wrote granule %j to PostgreSQL. Record cumulus_id in PostgreSQL: ${updatedPgGranule.cumulus_id}.
    `,
    updatedPgGranule
  );

  await _publishPostgresGranuleUpdateToSns({
    snsEventType,
    pgGranule: updatedPgGranule,
    knex,
  });
};

/**
 * Update granule status to 'failed'
 *
 * @param {Object} params
 * @param {Object} params.granule - Granule from the payload
 * @param {Knex} params.knex - knex Client
 * @param {Object} params.error - error object to be set in the granule
 * @returns {Promise}
 * @throws {Error}
 */
const updateGranuleStatusToFailed = async (params) => {
  const {
    granule,
    knex,
    error = {},
    collectionPgModel = new CollectionPgModel(),
    granulePgModel = new GranulePgModel(),
  } = params;
  const status = 'failed';
  const { granuleId, collectionId } = granule;
  log.info(`updateGranuleStatusToFailed(): granuleId: ${granuleId}, collectionId: ${collectionId}`);

  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(collectionId)
    );
    const pgGranule = await granulePgModel.get(
      knex,
      {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );

    await _updateGranule({
      apiGranule: granule,
      postgresGranule: pgGranule,
      apiFieldUpdates: { status, error },
      pgFieldUpdates: { status, error },
      granulePgModel,
      knex,
      snsEventType: 'Update',
    });
    log.debug(`Updated granule status to failed, granuleId: ${granule.granuleId}, PostgreSQL cumulus_id: ${pgGranule.cumulus_id}`);
  } catch (thrownError) {
    log.error(`Failed to update granule status to failed, granuleId: ${granule.granuleId}, collectionId: ${collectionId}`, thrownError.toString());
    throw thrownError;
  }
};

/**
 * Generate file records based on workflow status, write files to
 * the database, and update granule status if file writes fail
 *
 * @param {Object} params
 * @param {number} params.granuleCumulusId - Cumulus ID of the granule for this file
 * @param {ApiGranule} params.granule - Granule from the payload
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @returns {Promise<ReturnType<GranuleFileWriteError> | undefined>}
 */
const _writeGranuleFiles = async ({
  granuleCumulusId,
  granule,
  knex,
}) => {
  let fileRecords = [];
  const { files, granuleId, error: workflowError } = granule;
  // Only try to generate file records if there are valid files.
  // If `files` is an empty array, write the empty array
  if (isArray(files) && files.length > 0) {
    fileRecords = _generateFilePgRecords({
      files,
      granuleCumulusId,
    });
  }
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
    const errors = [];
    if (!isEmpty(workflowError)) {
      log.error(`Logging existing error encountered by granule ${granuleId} before overwrite`, workflowError);
      errors.push(workflowError);
    }
    log.error('Failed writing files to PostgreSQL, updating granule with error', error.toString());
    const errorObject = {
      Error: 'Failed writing files to PostgreSQL.',
      Cause: error.toString(),
    };
    errors.push(errorObject);

    const errorsObject = {
      errors: JSON.stringify(errors),
    };

    await updateGranuleStatusToFailed({
      granule,
      knex,
      error: errorsObject,
    });
    const returnError = new GranuleFileWriteError(JSON.stringify(errorObject));
    return returnError;
  }
  return undefined;
};

/**
 * Wrapper _writeGranuleFiles for Generate file records based on workflow status, write files to
 * the database, and update granule status if file writes fail
 *
 * @param {Object} params
 * @param {number} params.granuleCumulusId - Cumulus ID of the granule for this file
 * @param {ApiGranule} params.granule - Granule from the payload
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @throws {GranuleFileWriteError}
 * @returns {Promise<void>}
 */
const _writeGranuleFilesAndThrowIfExpectedWriteError = async ({
  granuleCumulusId,
  granule,
  knex,
}) => {
  const fileWriteError = await _writeGranuleFiles({
    granuleCumulusId,
    granule,
    knex,
  });
  if (fileWriteError) {
    throw fileWriteError;
  }
};

/**
 * Write granule to PostgreSQL, if any granule writes fail, keep the data stores in sync.
 *
 * @param {Object}            params
 * @param {PostgresGranuleRecord} params.postgresGranuleRecord - PostgreSQL granule record to write
 *                                                               to the database
 * @param {ApiGranuleRecord}  params.apiGranuleRecord - Api Granule object to write to the database
 * @param {Knex}              params.knex - Knex object
 * @param {number}            params.executionCumulusId - Execution ID the granule was written from
 * @param {boolean}           params.writeConstraints - Boolean flag to set if createdAt/execution
 *                                                      write constraints should restrict write
 *                                                      behavior in the database via
 *                                                      upsertGranuleWithExecutionJoinRecord
 * @param {GranulePgModel}    params.granulePgModel - @cumulus/db compatible granule module instance
 * @returns {Promise<{status:string, pgGranule:PostgresGranuleRecord}>} - Object containing status
 *                              of upsertGranuleWithExecutionJoinRecord ('succeeded' or 'dropped'),
 *                              along with the latest granule in PG, which is the result of the
 *                              upsert operation if successful
 * @throws {Error}
 */
const _writeGranuleRecords = async (params) => {
  const {
    postgresGranuleRecord,
    apiGranuleRecord,
    knex,
    executionCumulusId,
    granulePgModel,
    writeConstraints = true,
  } = params;
  /**
   * @type { { status: string, pgGranule: PostgresGranuleRecord } | undefined }
   */
  let writePgGranuleResult;

  log.info('About to write granule record %j to PostgreSQL', postgresGranuleRecord);
  try {
    await createRejectableTransaction(knex, async (trx) => {
      // Validate API schema using lib method
      recordIsValid(omitBy(apiGranuleRecord, isNull), granuleSchema, false);
      writePgGranuleResult = await _writePostgresGranuleViaTransaction({
        granuleRecord: postgresGranuleRecord,
        executionCumulusId,
        trx,
        granulePgModel,
        writeConstraints,
      });
    });
    if (writePgGranuleResult === undefined) {
      // unlikely to happen but want a unique message that we can find and diagnose
      throw new Error('Write Granule failed in Postgres and not caught by rejectable transaction.');
    }
    if (writePgGranuleResult.status === 'dropped') {
      return writePgGranuleResult;
    }
    log.info(
      `Completed write operation to PostgreSQL for granule %j. Record cumulus_id in PostgreSQL: ${writePgGranuleResult.pgGranule.cumulus_id}.`,
      postgresGranuleRecord
    );
    return writePgGranuleResult;
  } catch (thrownError) {
    log.error(`Write Granule failed: ${JSON.stringify(thrownError)}`);

    // TODO: apiGranuleRecord is not actually required here, only needs specific id and status
    // fields. refactor in the future.

    // If granule is in a final state and the error thrown
    // is a SchemaValidationError then update the granule
    // status to failed
    if (isStatusFinalState(apiGranuleRecord.status)
      && thrownError.name === 'SchemaValidationError') {
      const originalError = apiGranuleRecord.error;
      const errors = [];
      if (originalError) {
        errors.push(originalError);
      }
      const errorObject = {
        Error: 'Failed writing granule record due to SchemaValdationError.',
        Cause: thrownError,
      };
      errors.push(errorObject);
      const errorsObject = {
        errors: JSON.stringify(errors),
      };

      await updateGranuleStatusToFailed({
        granule: apiGranuleRecord,
        knex,
        error: errorsObject,
      });
      throw new Error('Granule/granule files failed schema validation and will be updated in the datastore with the error and a status of failed', { cause: thrownError });
    }
    throw thrownError;
  }
};

/**
 * Write a granule record to PostgreSQL and publish SNS topic updates
 *
 * @param {Object}                    params - params object
 * @param {typeof _writeGranuleFiles} params.writeGranuleFilesMethod - Internal method to use to
 *                                                                     write granule files
 * @param {Knex}                      params.knex - Knex object
 * @param {string}                    params.snsEventType - SNS Event Type
 * @param {boolean}                   params.writeConstraints - Boolean flag to set if
 *                                       createdAt/execution write constraints should restrict write
 *                                       behavior in the database via
 *                                       upsertGranuleWithExecutionJoinRecord
 * @param {PostgresGranuleRecord} params.postgresGranuleRecord - PostgreSQL granule record to write
 *                                                               to the database
 * @param {ApiGranuleRecord}  params.apiGranuleRecord - Api Granule object to write to the database
 * @param {number}            params.executionCumulusId - Execution ID the granule was written from
 * @param {GranulePgModel}    params.granulePgModel - @cumulus/db compatible granule module instance
 * @returns {Promise<void>}
 */
const _writeGranule = async ({
  postgresGranuleRecord,
  apiGranuleRecord,
  executionCumulusId,
  granulePgModel,
  knex,
  snsEventType,
  writeConstraints = true,
  writeGranuleFilesMethod = _writeGranuleFiles,
}) => {
  const { status } = apiGranuleRecord;
  const writePgGranuleResult = await _writeGranuleRecords({
    apiGranuleRecord,
    executionCumulusId,
    granulePgModel,
    knex,
    postgresGranuleRecord,
    writeConstraints,
  });
  const pgGranule = writePgGranuleResult.pgGranule;

  if (writePgGranuleResult.status === 'success') {
    // Files are only written to Postgres if the granule is in a "final" state
    // (e.g. "status: completed") and there is a valid `files` key in the granule.
    // An empty array of files will remove existing file records but a missing
    // `files` key will not.
    if ((writeConstraints === false || (isStatusFinalState(status))) && 'files' in apiGranuleRecord) {
      await writeGranuleFilesMethod({
        granuleCumulusId: pgGranule.cumulus_id,
        granule: apiGranuleRecord,
        knex,
      });
    }

    await _publishPostgresGranuleUpdateToSns({
      snsEventType,
      pgGranule,
      knex,
    });
  }
};

/**
 * Filters and handles failed granule write operations from an array of Promise.allSettled results.
 *
 * This function examines the results of parallel granule write operations and identifies any
 * that failed. If failures are found, it aggregates all error reasons into a single
 * AggregateError, logs the error with the provided message, and throws the aggregated error
 * to halt execution and provide error information to the caller.
 *
 * @param {Array<{status: 'fulfilled'|'rejected', value?: any, reason?: Error}>} results -
 *   Array of results from Promise.allSettled(), where each result has a 'status' property
 *   indicating 'fulfilled' or 'rejected'
 * @param {string} errorMessage - Error message to log when failed writing to the database
 * @returns {Array} - Returns the original results array if no rejected promises are detected
 * @throws {AggregateError} -
 */
const _filterGranuleWriteFailures = (results, errorMessage) => {
  const failedWrites = results.filter((result) => result.status === 'rejected');
  if (failedWrites.length > 0) {
    const allFailures = failedWrites.map((failure) => failure.reason);
    const aggregateError = new AggregateError(allFailures);
    log.error(errorMessage, aggregateError);
    throw aggregateError;
  }
  return failedWrites;
};

/**
* Method to facilitate partial granule record updates
* @summary In cases where a full API record is not passed, but partial/tangential updates to granule
*          records are called for, updates to files records are not required and pre-write
*          calculation in methods like write/update GranulesFromApi result in unneded
*          evaluation/database writes /etc. This method updates postgres and
*          publishes the SNS update event without incurring unneded overhead.
* @param {Object}          params
* @param {Object}          params.apiGranuleRecord - Api Granule object to write to the database
* @param {number}          params.executionCumulusId - Execution ID the granule was written from
* @param {Object}          params.granulePgModel - @cumulus/db compatible granule module instance
* @param {Knex}            params.knex - Knex object
* @param {Object}          params.postgresGranuleRecord - PostgreSQL granule record to write
*                                                         to database
* @param {string}          params.snsEventType - SNS Event Type
* @returns {Promise}
*/
const writeGranuleRecordAndPublishSns = async ({
  postgresGranuleRecord,
  apiGranuleRecord,
  executionCumulusId,
  granulePgModel,
  knex,
  snsEventType = 'Update',
}) => {
  const writePgGranuleResult = await _writeGranuleRecords({
    apiGranuleRecord: omit(apiGranuleRecord, 'files'),
    executionCumulusId,
    granulePgModel,
    knex,
    postgresGranuleRecord,
  });
  const pgGranule = writePgGranuleResult.pgGranule;

  await _publishPostgresGranuleUpdateToSns({
    snsEventType,
    pgGranule,
    knex,
  });
};

/**
 * Thin wrapper to _writeGranule used by endpoints/granule to create a granule
 * directly.
 *
 * @param {Object} granule -- API Granule object
 * @param {string} [granule.files] - **May not be null, set [] to remove** -- granule files object
 * @param {GranuleStatus} granule.status - **required field, may not be null,
 *                                         or undefined**
 *                                         -- ['running','failed','completed', 'queued']
 * @param {string} [granule.granuleId] - *required field,may not be null,or undefined*
 *                                        granule's id
 * @param {string} [granule.collectionId] - *required field,may not be null,or undefined*
 *                                        granule's collection id
 * @param {string} [granule.execution] - Execution URL to associate with this granule
 *                               must already exist in database.
 * @param {string} [granule.cmrLink] - url to CMR information for this granule.
 * @param {boolean} [granule.published] - published to cmr
 * @param {string} [granule.pdrName] - pdr name
 * @param {string} [granule.provider] - provider
 * @param {Object} [granule.error = {}] - workflow errors
 * @param {string} [granule.createdAt = new Date().valueOf()] - time value
 * @param {string} [granule.timestamp] - timestamp
 * @param {string} [granule.updatedAt = new Date().valueOf()] - time value
 * @param {number} [granule.duration] - seconds
 * @param {string} granule.producerGranuleId - producer granule id
 * @param {string} [granule.productVolume] - sum of the files sizes in bytes
 * @param {integer} [granule.timeToPreprocess] -  seconds
 * @param {integer} [granule.timeToArchive] - seconds
 * @param {Array<ApiFile>} granule.files - files associated with the granule.
 * @param {string} [granule.beginningDateTime] - CMR Echo10:
 *                                               Temporal.RangeDateTime.BeginningDateTime
 * @param {string} [granule.endingDateTime] - CMR Echo10: Temporal.RangeDateTime.EndingDateTime
 * @param {string} [granule.productionDateTime] - CMR Echo10: DataGranule.ProductionDateTime
 * @param {string} [granule.lastUpdateDateTime] - CMR Echo10: LastUpdate || InsertTime
 * @param {string} [granule.processingStartDateTime] - execution startDate
 * @param {string} [granule.processingEndDateTime] - execution StopDate
 * @param {Object} [granule.queryFields] - query fields
 * @param {Object} [granule.granulePgModel] - only for testing.
 * @param {Knex} knex - knex Client
 * @param {string} snsEventType - SNS Event Type
 * @returns {Promise}
 */
const writeGranuleFromApi = async (
  {
    granuleId,
    collectionId,
    createdAt,
    status,
    execution,
    cmrLink,
    published,
    pdrName,
    provider,
    error,
    updatedAt,
    duration,
    producerGranuleId,
    productVolume,
    timeToPreprocess,
    timeToArchive,
    timestamp,
    files,
    beginningDateTime,
    endingDateTime,
    productionDateTime,
    lastUpdateDateTime,
    processingStartDateTime,
    processingEndDateTime,
    queryFields,
    granulePgModel = new GranulePgModel(),
  },
  knex,
  snsEventType
) => {
  try {
    // If published is set to null, set default value to false
    // instead of allowing nullish value

    // New granules should have published set when calling this method.  Assume undefined
    // is a PATCH request
    const publishedValue = isNull(published) ? false : published;
    const defaultSetError = isNull(error) ? {} : error;
    const defaultSetFiles = isNull(files) ? [] : files;
    const defaultCreatedAt = isNull(createdAt) ? Date.now() : createdAt;
    // Validate fields that cannot/shouldn't be null aren't
    const invalidNullableFields = {
      status,
      createdAt,
      updatedAt,
      granuleId,
      collectionId,
      execution,
      producerGranuleId,
    };
    Object.entries(invalidNullableFields).forEach(([key, field]) => {
      if (isNull(field)) {
        throw new Error(`granule.'${key}' cannot be removed as it is required and/or set to a default value on PUT.  Please set a value and try your request again`);
      }
    });
    // Throw for invalid nullish value
    if (isNull(execution)) {
      throw new Error('Granule execution cannot be null, granules can only be assigned to an existing execution via the API object or POST /:granuleId/executions');
    }

    const granule = {
      granuleId,
      cmrLink,
      producerGranuleId,
      published: publishedValue,
      createdAt: defaultCreatedAt,
      error: defaultSetError,
    };
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
      cmrTemporalInfo,
      cmrUtils,
      collectionId,
      createdAt: defaultCreatedAt,
      duration,
      executionUrl: execution,
      error: defaultSetError,
      files: defaultSetFiles,
      granule,
      pdrName,
      processingTimeInfo,
      productVolume,
      provider,
      queryFields,
      status,
      timestamp,
      timeToArchive,
      timeToPreprocess,
      updatedAt,
    });

    const postgresGranuleRecord = await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
      dynamoRecord: apiGranuleRecord,
      knexOrTransaction: knex,
    });
    await _writeGranule({
      apiGranuleRecord,
      executionCumulusId,
      granulePgModel,
      knex,
      postgresGranuleRecord: omitBy(postgresGranuleRecord, isUndefined),
      snsEventType,
      writeConstraints: false,
      writeGranuleFilesMethod: _writeGranuleFilesAndThrowIfExpectedWriteError,
    });
    return `Wrote Granule ${granule.granuleId}`;
  } catch (thrownError) {
    log.error('Failed to write granule', thrownError);
    throw thrownError;
  }
};

const createGranuleFromApi = async (granule, knex) => {
  await writeGranuleFromApi(granule, knex, 'Create');
};

const updateGranuleFromApi = async (granule, knex) => {
  await writeGranuleFromApi(granule, knex, 'Update');
};

/**
 * Validate that every element in arr has a granuleId.
 * Throws if any element is invalid.
 *
 * @param {unknown[]} unknownGranuleArray
 * @returns {GranuleWithGranuleId[]}
 */
const _granulesWithIds = (unknownGranuleArray) => {
  if (!Array.isArray(unknownGranuleArray)) {
    throw new TypeError('Expected an array of granules');
  }

  if (!unknownGranuleArray.every((g) => isObject(g) && g !== null && 'granuleId' in g && isString(g.granuleId))) {
    throw new TypeError('Invalid granule: missing granuleId');
  }

  // Safe to cast, since we validated all items
  return /** @type {GranuleWithGranuleId[]} */ (unknownGranuleArray);
};

/**
 * Write granule-to-execution cross-references from a Cumulus message to PostgreSQL.
 *
 * @param {object} params - The input parameters.
 * @param {CumulusMessage} params.cumulusMessage - The Cumulus workflow message.
 * @param {number} params.executionCumulusId - Cumulus ID for the execution referenced
 *   in the workflow message.
 * @param {Knex} params.knex - A Knex client instance for interacting with PostgreSQL.
 * @param {GranulePgModel} [params.granulePgModel] - Optional override for the GranulePgModel.
 * @param {GranulesExecutionsPgModel} [params.granulesExecutionsPgModel] - Optional
 *   override for the GranulesExecutionsPgModel.
 * @returns {Promise<object[]|undefined>} - Results from Promise.allSettled()` for
 *   each granule, or `undefined` if no granules exist.
 * @throws {Error} - Throws on unexpected database errors.
 */
const writeGranuleExecutionAssociationsFromMessage = async ({
  cumulusMessage,
  executionCumulusId,
  knex,
  granulePgModel = new GranulePgModel(),
  granulesExecutionsPgModel = new GranulesExecutionsPgModel(),
}) => {
  if (!messageHasGranules(cumulusMessage)) {
    log.info('No granules found in message. Skipping granules-executions cross-reference write.');
    return undefined;
  }

  const granules = _granulesWithIds(getMessageGranules(cumulusMessage));
  const granuleIds = granules.map((granule) => granule.granuleId);

  log.info(`Found granules: [${granuleIds.join(', ')}]. Fetching corresponding cumulus IDs...`);

  const granuleCumulusIds = await granulePgModel.getRecordsCumulusIds(knex, ['granule_id'], granuleIds);

  log.info(`Retrieved ${granuleCumulusIds.length} granule cumulus IDs for granule IDs: [${granuleIds.join(', ')}]`);

  const results = await Promise.allSettled(
    granuleCumulusIds.map((granuleCumulusId) =>
      granulesExecutionsPgModel.upsert(knex, {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }))
  );

  const filteredResults = _filterGranuleWriteFailures(results, 'Failed writing some granule-execution associations');
  log.debug('Completed upsert of granule-execution associations.');
  return filteredResults;
};

/**
 * Write granules from a cumulus message to PostgreSQL
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {Object} [params.granulePgModel]
 *   Optional override for the granule model writing to PostgreSQL database
 * @param {Object} params.testOverrides - Used only for test mocks
 * @returns {Promise<Object[] | undefined>}
 *  true if there are no granules on the message, otherwise
 *  results from Promise.allSettled for all granules
 * @throws {Error}
 */
const writeGranulesFromMessage = async ({
  cumulusMessage,
  executionCumulusId,
  knex,
  granulePgModel = new GranulePgModel(),
  testOverrides = {}, // Used only for test mocks
}) => {
  if (!messageHasGranules(cumulusMessage)) {
    log.info('No granules to write, skipping writeGranulesFromMessage');
    return undefined;
  }

  const { stepFunctionUtils } = testOverrides;
  const granules = getMessageGranules(cumulusMessage);
  const granuleIds = granules.map((granule) => granule.granuleId);
  log.info(`process granule IDs ${granuleIds.join(',')}`);

  const executionArn = getMessageExecutionArn(cumulusMessage);
  const executionUrl = getExecutionUrlFromArn(executionArn);
  const executionDescription = await describeGranuleExecution(executionArn, stepFunctionUtils);
  const processingTimeInfo = getExecutionProcessingTimeInfo(executionDescription);
  const provider = getMessageProvider(cumulusMessage);
  const error = parseException(cumulusMessage.exception);
  const workflowStatus = getMetaStatus(cumulusMessage);
  const collectionId = getCollectionIdFromMessage(cumulusMessage);
  const pdrName = getMessagePdrName(cumulusMessage);
  const queryFields = getGranuleQueryFields(cumulusMessage);

  let workflowStartTime;
  try {
    workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
    if (!workflowStartTime) {
      throw new CumulusMessageError(
        'writeGranulesFromMessage called without a valid workflow start time in the Cumulus Message, all granules failed to write'
      );
    }
  } catch (wfError) {
    log.error(
      `Granule writes failed for ${JSON.stringify(
        cumulusMessage
      )} due to no workflow start time being set`
    );
    throw wfError;
  }

  // Process each granule in a separate transaction via Promise.allSettled
  // so that they can succeed/fail independently
  const results = await Promise.allSettled(granules.map(
    async (granule) => {
      // FUTURE: null files are currently not supported in update payloads
      // RDS Phase 3 should revise logic to accept an explicit null value
      if (granule.files === null) {
        throw new CumulusMessageError('granule.files must not be null');
      }

      // This is necessary to set properties like
      // `key`, which is required for the PostgreSQL schema. And
      // `size` which is used to calculate the granule product
      // volume
      let files;
      if (isNull(granule.files)) files = [];

      files = granule.files ? await FileUtils.buildDatabaseFiles({
        s3: s3(),
        providerURL: buildURL(provider),
        files: granule.files,
      }) : undefined;
      const timeToArchive = getGranuleTimeToArchive(granule);
      const timeToPreprocess = getGranuleTimeToPreprocess(granule);
      const productVolume = files ? getGranuleProductVolume(files) : undefined;

      const now = Date.now();
      const duration = getWorkflowDuration(workflowStartTime, now);
      const status = getGranuleStatus(workflowStatus, granule);
      const updatedAt = now;
      const timestamp = now;

      let published = granule.published;
      // New granules should have published set when calling this method.
      // Calling undefined will result in this value being set to false
      if (isNil(published)) {
        published = false;
      }

      // if producerGranuleId is not in granule object, set it the same as granuleId
      const apiGranuleRecord = await generateGranuleApiRecord({
        granule: {
          ...granule,
          published,
          createdAt: granule.createdAt || workflowStartTime,
          producerGranuleId: granule.producerGranuleId || granule.granuleId,
        },
        executionUrl,
        collectionId,
        provider: provider.id,
        files,
        error,
        pdrName,
        workflowStatus,
        timestamp,
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
      const postgresGranuleRecord = await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
        dynamoRecord: apiGranuleRecord,
        knexOrTransaction: knex,
      });

      // TODO: CUMULUS-3017 - Remove this unique collectionId condition
      // Check if granuleId exists across another collection
      const granulesByGranuleId = await getGranulesByGranuleId(knex, apiGranuleRecord.granuleId);
      const granuleExistsAcrossCollection = granulesByGranuleId.some(
        (g) => g.collection_cumulus_id !== postgresGranuleRecord.collection_cumulus_id
      );
      if (granuleExistsAcrossCollection) {
        log.error('Could not write granule. It already exists across another collection');
        const conflictError = new Error(
          `A granule already exists for granuleId: ${apiGranuleRecord.granuleId} with collectionId: ${apiGranuleRecord.collectionId}`
        );
        throw conflictError;
      }

      return _writeGranule({
        apiGranuleRecord,
        executionCumulusId,
        granulePgModel,
        knex,
        postgresGranuleRecord: omitBy(postgresGranuleRecord, isUndefined),
        snsEventType: 'Update',
        writeConstraints: true,
      });
    }
  ));
  return _filterGranuleWriteFailures(results, 'Failed writing some granules to Postgres');
};

/**
 * Update granule status to 'queued'
 *
 * @param {Object} params
 * @param {Object} params.apiGranule - api granule object
 * @param {Knex} params.knex - knex Client
 * @returns {Promise}
 * @throws {Error}
 */
const updateGranuleStatusToQueued = async (params) => {
  const {
    apiGranule,
    knex,
    collectionPgModel = new CollectionPgModel(),
    granulePgModel = new GranulePgModel(),
  } = params;
  const status = 'queued';
  const { granuleId, collectionId } = apiGranule;
  log.info(`updateGranuleStatusToQueued granuleId: ${granuleId}, collectionId: ${collectionId}`);

  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(collectionId)
    );
    const pgGranule = await granulePgModel.get(
      knex,
      {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );

    await _updateGranule({
      apiGranule,
      postgresGranule: pgGranule,
      apiFieldUpdates: { status },
      pgFieldUpdates: { status },
      apiFieldsToDelete: ['execution'],
      granulePgModel,
      knex,
      snsEventType: 'Update',
    });

    log.debug(`Updated granule status to queued, PostgreSQL cumulus_id: ${pgGranule.cumulus_id}`);
  } catch (thrownError) {
    log.error(`Failed to update granule status to queued, granuleId: ${apiGranule.granuleId}, collectionId: ${collectionId}`, thrownError);
    throw thrownError;
  }
};

module.exports = {
  _writeGranule,
  _writeGranuleFilesAndThrowIfExpectedWriteError,
  createGranuleFromApi,
  generateFilePgRecord,
  getGranuleFromQueryResultOrLookup,
  updateGranuleFromApi,
  updateGranuleStatusToQueued,
  updateGranuleStatusToFailed,
  writeGranuleExecutionAssociationsFromMessage,
  writeGranuleFromApi,
  writeGranulesFromMessage,
  writeGranuleRecordAndPublishSns,
};

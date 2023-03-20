// @ts-check

'use strict';

const AggregateError = require('aggregate-error');
const isArray = require('lodash/isArray');
const isEmpty = require('lodash/isEmpty');
const isNil = require('lodash/isNil');
const omit = require('lodash/omit');
const isNull = require('lodash/isNull');

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
  getGranulesByGranuleId,
  translateApiFiletoPostgresFile,
  upsertGranuleWithExecutionJoinRecord,
  translateApiGranuleToPostgresGranuleWithoutNilsRemoved,
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

const {
  CumulusMessageError,
  RecordDoesNotExist,
} = require('@cumulus/errors');

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
  isStatusFinalState,
  isStatusActiveState,
} = require('./utils');

/**
* @typedef { import('knex').Knex } Knex
* @typedef { import('knex').Knex.Transaction } KnexTransaction
* @typedef { typeof Search.es } Esclient and update type
* @typedef { import('@cumulus/types').ApiGranule } ApiGranule
* @typedef { import('@cumulus/types').ApiGranuleRecord } ApiGranuleRecord
* @typedef { Granule } ApiGranuleModel
* @typedef { import('@cumulus/db').PostgresGranuleRecord } PostgresGranuleRecord
* @typedef { import('@cumulus/db').PostgresFile } PostgresFile
* @typedef { import('@cumulus/db').PostgresFileRecord } PostgresFileRecord
* @typedef { import('@cumulus/db').GranulePgModel } GranulePgModel
* @typedef { import('@cumulus/db').FilePgModel } FilePgModel
*/

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
 * Update granule record status in DynamoDB, PostgreSQL, Elasticsearch.
 * Publish SNS event for updated granule.
 *
 * @param {Object}  params
 * @param {Object}  params.apiGranule            - API Granule object to write to
 *                                                 the database
 * @param {Object}  params.postgresGranule       - PostgreSQL granule
 * @param {Object}  params.apiFieldUpdates       - API fields to update
 * @param {Object}  params.pgFieldUpdates        - PostgreSQL fields to update
 * @param {Object}  params.apiFieldsToDelete     - API fields to delete
 * @param {Object}  params.granuleModel          - Instance of DynamoDB granule model
 * @param {Object}  params.granulePgModel        - @cumulus/db compatible granule module instance
 * @param {Knex}    params.knex                  - Knex object
 * @param {string}  params.snsEventType          - SNS Event Type, defaults to 'Update'
 * @param {Object}  params.esClient              - Elasticsearch client
 * returns {Promise}
 */
const _updateGranule = async ({
  apiGranule,
  postgresGranule,
  apiFieldUpdates,
  pgFieldUpdates,
  apiFieldsToDelete,
  granuleModel,
  granulePgModel,
  knex,
  snsEventType = 'Update',
  esClient,
}) => {
  const granuleId = apiGranule.granuleId;
  const esGranule = omit(apiGranule, apiFieldsToDelete);

  let updatedPgGranule;
  await createRejectableTransaction(knex, async (trx) => {
    [updatedPgGranule] = await granulePgModel.update(
      trx,
      { cumulus_id: postgresGranule.cumulus_id },
      pgFieldUpdates,
      ['*']
    );
    log.info(`Successfully wrote granule ${granuleId} to PostgreSQL`);
    try {
      await granuleModel.update({ granuleId }, apiFieldUpdates, apiFieldsToDelete);
      log.info(`Successfully wrote granule ${granuleId} to DynamoDB`);
      await upsertGranule({
        esClient,
        updates: {
          ...esGranule,
          ...apiFieldUpdates,
        },
        index: process.env.ES_INDEX,
      });
      log.info(`Successfully wrote granule ${granuleId} to Elasticsearch`);
    } catch (writeError) {
      log.error(`Writes to DynamoDB/Elasticsearch failed, rolling back all writes for granule ${granuleId}`, writeError);
      // On error, recreate the DynamoDB record to revert it back to original
      // status to ensure that all systems stay in sync
      await granuleModel.create(apiGranule);
      throw writeError;
    }
  });

  log.info(
    `
    Successfully wrote granule %j to PostgreSQL. Record cumulus_id in PostgreSQL: ${updatedPgGranule.cumulus_id}.
    `,
    updatedPgGranule
  );
  log.info('Successfully wrote granule %j to DynamoDB', apiGranule);

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
    granuleModel = new Granule(),
    granulePgModel = new GranulePgModel(),
    esClient = await Search.es(),
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
      granuleModel,
      granulePgModel,
      knex,
      snsEventType: 'Update',
      esClient,
    });
    log.debug(`Updated granule status to failed, Dynamo granuleId: ${granule.granuleId}, PostgreSQL cumulus_id: ${pgGranule.cumulus_id}`);
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
 * @returns {Promise<void>}
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
  }
};

/**
 * Write granule to PostgreSQL, DynamoDB, and ElasticSearch, keeping granules to be written in sync
 * as necessary.
 * If any granule writes fail, keep the data stores in sync.
 *
 * @param {Object}            params
 * @param {PostgresGranuleRecord} params.postgresGranuleRecord - PostgreSQL granule record to write
 *                                                               to the database
 * @param {ApiGranuleRecord}  params.apiGranuleRecord - Api Granule object to write to the database
 * @param {Knex}              params.knex - Knex object
 * @param {Esclient}          params.esClient - Elasticsearch client
 * @param {ApiGranuleModel}   params.granuleModel - Instance of DynamoDB granule model
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
    esClient = await Search.es(),
    granuleModel,
    executionCumulusId,
    granulePgModel,
    writeConstraints = true,
  } = params;
  let pgGranule;
  /**
   * @type { { status: string, pgGranule: PostgresGranuleRecord } | undefined }
   */
  let writePgGranuleResult;
  let limitedUpdateApiGranuleRecord;

  log.info('About to write granule record %j to PostgreSQL', postgresGranuleRecord);
  log.info('About to write granule record %j to DynamoDB', apiGranuleRecord);

  try {
    await createRejectableTransaction(knex, async (trx) => {
      writePgGranuleResult = await _writePostgresGranuleViaTransaction({
        granuleRecord: postgresGranuleRecord,
        executionCumulusId,
        trx,
        granulePgModel,
        writeConstraints,
      });
      if (writePgGranuleResult.status === 'dropped') {
        return;
      }
      pgGranule = writePgGranuleResult.pgGranule;

      if (writeConstraints && isStatusActiveState(pgGranule.status)) {
        // pgGranule was updated, but with writeConstraints conditions and the granule status is
        // 'queued' or 'running', so only some values were updated. we need to ensure the correct
        // values are propagated to Dynamo and ES.
        // The only values allowed to be updated in the PG granule write under these conditions are
        // currently status, timestamp, updated_at, and created_at, and the associated execution
        // as part of the write chain
        limitedUpdateApiGranuleRecord = await translatePostgresGranuleToApiGranule({
          granulePgRecord: pgGranule,
          knexOrTransaction: trx,
        });

        await granuleModel.storeGranule(limitedUpdateApiGranuleRecord, writeConstraints);
        await upsertGranule({
          esClient,
          updates: limitedUpdateApiGranuleRecord,
          index: process.env.ES_INDEX,
        }, writeConstraints);
      } else {
        // Future: refactor to cover the entire object?
        // Ensure PG default createdAt value is propagated to DynamoDB/ES
        // in the case where _writeGranule is called without createdAt set
        if (!apiGranuleRecord.createdAt) {
          apiGranuleRecord.createdAt = pgGranule.created_at.getTime();
        }

        // TODO: refactor to not need apiGranuleRecord, only need files and a few other fields
        await granuleModel.storeGranule(apiGranuleRecord, writeConstraints);
        await upsertGranule({
          esClient,
          updates: apiGranuleRecord,
          index: process.env.ES_INDEX,
        }, writeConstraints);
      }
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
    // TODO: need to log either limitedUpdateApiGranuleRecord || apiGranuleRecord
    log.info(
      'Completed write operation to DynamoDb for granule %j',
      limitedUpdateApiGranuleRecord || apiGranuleRecord
    );
    return writePgGranuleResult;
  } catch (thrownError) {
    log.error(`Write Granule failed: ${JSON.stringify(thrownError)}`);

    // TODO: apiGranuleRecord is not actually required here, only needs specific id and status
    // fields. refactor in the future.

    // If a postgres record was provided
    // attempt to ensure alignment between postgress/dynamo/es
    if (writePgGranuleResult?.status === 'success') {
      pgGranule = writePgGranuleResult.pgGranule;
      // Align dynamo granule record with postgres record
      // Retrieve the granule from postgres
      let pgGranuleExists;
      /**
       * @type { PostgresGranuleRecord | undefined }
       */
      let latestPgGranule;
      try {
        latestPgGranule = await granulePgModel.get(knex, {
          granule_id: pgGranule.granule_id,
          collection_cumulus_id: pgGranule.collection_cumulus_id,
        });
        pgGranuleExists = true;
      } catch (getPgGranuleError) {
        log.error(`Could not retrieve latest postgres record for granule_id ${pgGranule.granule_id} because ${JSON.stringify(getPgGranuleError)}`);
        if (getPgGranuleError instanceof RecordDoesNotExist) {
          pgGranuleExists = false;
        }
        latestPgGranule = undefined;
      }

      // Delete the dynamo record (stays deleted if postgres record does not exist)
      await granuleModel.delete({
        granuleId: apiGranuleRecord.granuleId,
        collectionId: apiGranuleRecord.collectionId,
      });
      // Recreate the dynamo record in alignment with postgres if the postgres record exists
      if (pgGranuleExists) {
        if (latestPgGranule === undefined) {
          // unlikely to happen but want a unique message that we can find and diagnose
          throw new Error("Retrieving granule latestPgGranule from Postgres returned nothing and didn't throw.");
        }
        const alignedDynamoRecord = await translatePostgresGranuleToApiGranule(
          {
            granulePgRecord: latestPgGranule,
            knexOrTransaction: knex,
          }
        );
        await granuleModel.storeGranule(alignedDynamoRecord, writeConstraints);
      }

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
          Error: 'Failed writing dynamoGranule due to SchemaValdationError.',
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
      }
    }
    throw thrownError;
  }
};

/**
 * Write a granule record to DynamoDB and PostgreSQL
 *
 * @param {Object}            params - params object
 * @param {Knex}              params.knex - Knex object
 * @param {string}            params.snsEventType - SNS Event Type
 * @param {boolean}           params.writeConstraints - Boolean flag to set if createdAt/execution
 *                                                      write constraints should restrict write
 *                                                      behavior in the database via
 *                                                      upsertGranuleWithExecutionJoinRecord
 * @param {PostgresGranuleRecord} params.postgresGranuleRecord - PostgreSQL granule record to write
 *                                                               to the database
 * @param {ApiGranuleRecord}  params.apiGranuleRecord - Api Granule object to write to the database
 * @param {Esclient}          params.esClient - Elasticsearch client
 * @param {number}            params.executionCumulusId - Execution ID the granule was written from
 * @param {ApiGranuleModel}   params.granuleModel - Instance of DynamoDB granule model
 * @param {GranulePgModel}    params.granulePgModel - @cumulus/db compatible granule module instance
 * @returns {Promise<void>}
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
  writeConstraints = true,
}) => {
  const { status } = apiGranuleRecord;
  const writePgGranuleResult = await _writeGranuleRecords({
    apiGranuleRecord,
    esClient,
    executionCumulusId,
    granuleModel,
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
      await _writeGranuleFiles({
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
* Method to facilitate parital granule record updates
* @summary In cases where a full API record is not passed, but partial/tangential updates to granule
*          records are called for, updates to files records are not required and pre-write
*          calculation in methods like write/update GranulesFromApi result in unneded
*          evaluation/database writes /etc. This method updates the postgres/Dynamo/ES datastore and
*          publishes the SNS update event without incurring unneded overhead.
* @param {Object}          params
* @param {Object}          params.apiGranuleRecord - Api Granule object to write to the database
* @param {number}          params.executionCumulusId - Execution ID the granule was written from
* @param {Object}          params.esClient - Elasticsearch client
* @param {Object}          params.granuleModel - Instance of DynamoDB granule model
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
  esClient,
  executionCumulusId,
  granuleModel,
  granulePgModel,
  knex,
  snsEventType = 'Update',
}) => {
  const writePgGranuleResult = await _writeGranuleRecords({
    apiGranuleRecord,
    esClient,
    executionCumulusId,
    granuleModel,
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
 * @param {Object} [granule.granuleModel] - only for testing.
 * @param {Object} [granule.granulePgModel] - only for testing.
 * @param {Knex} knex - knex Client
 * @param {Object} esClient - Elasticsearch client
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
    granuleModel = new Granule(),
    granulePgModel = new GranulePgModel(),
  },
  knex,
  esClient,
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
    };
    Object.entries(invalidNullableFields).forEach(([key, field]) => {
      if (isNull(invalidNullableFields[field])) {
        throw new Error(`granule.'${key}' cannot be removed as it is required and/or set to a default value on PUT.  Please set a value and try your request again`);
      }
    });
    // Throw for invalid nullish value
    if (isNull(execution)) {
      throw new Error('Granule execution cannot be null, granules can only be assigned to an existing execution via the API object or POST /:granuleName/executions');
    }

    const granule = {
      granuleId,
      cmrLink,
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
      esClient,
      executionCumulusId,
      granuleModel,
      granulePgModel,
      knex,
      postgresGranuleRecord: omitBy(postgresGranuleRecord, isUndefined),
      snsEventType,
      writeConstraints: false,
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
 * @param {Object}  params.esClient - Elasticsearch client
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

      const apiGranuleRecord = await generateGranuleApiRecord({
        granule: { ...granule, published, createdAt: granule.createdAt || workflowStartTime },
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
        esClient,
        executionCumulusId,
        granuleModel,
        granulePgModel,
        knex,
        postgresGranuleRecord: omitBy(postgresGranuleRecord, isUndefined),
        snsEventType: 'Update',
        writeConstraints: true,
      });
    }
  ));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const allFailures = failures.map((failure) => failure.reason);
    const aggregateError = new AggregateError(allFailures);
    log.error('Failed writing some granules to Dynamo/Postgres/Elasticsearch', aggregateError);
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
const updateGranuleStatusToQueued = async (params) => {
  const {
    granule,
    knex,
    collectionPgModel = new CollectionPgModel(),
    granuleModel = new Granule(),
    granulePgModel = new GranulePgModel(),
    esClient = await Search.es(),
  } = params;
  const status = 'queued';
  const { granuleId, collectionId } = granule;
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
      apiGranule: granule,
      postgresGranule: pgGranule,
      apiFieldUpdates: { status },
      pgFieldUpdates: { status },
      apiFieldsToDelete: ['execution'],
      granuleModel,
      granulePgModel,
      knex,
      snsEventType: 'Update',
      esClient,
    });

    log.debug(`Updated granule status to queued, Dynamo granuleId: ${granule.granuleId}, PostgreSQL cumulus_id: ${pgGranule.cumulus_id}`);
  } catch (thrownError) {
    log.error(`Failed to update granule status to queued, granuleId: ${granule.granuleId}, collectionId: ${collectionId}`, thrownError);
    throw thrownError;
  }
};

module.exports = {
  _writeGranule,
  createGranuleFromApi,
  generateFilePgRecord,
  getGranuleFromQueryResultOrLookup,
  updateGranuleFromApi,
  updateGranuleStatusToQueued,
  updateGranuleStatusToFailed,
  writeGranuleFromApi,
  writeGranulesFromMessage,
  writeGranuleRecordAndPublishSns,
};

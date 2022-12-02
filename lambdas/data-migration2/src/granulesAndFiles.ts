import { Knex } from 'knex';
import { Writable } from 'stream';
import pMap from 'p-map';
import cloneDeep from 'lodash/cloneDeep';
import {
  ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  NativeAttributeValue,
} from '@aws-sdk/util-dynamodb';

import { parallelScan } from '@cumulus/aws-client/DynamoDb';
import { dynamodbDocClient } from '@cumulus/aws-client/services';
import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { ApiFile } from '@cumulus/types/api/files';
import {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  upsertGranuleWithExecutionJoinRecord,
  FilePgModel,
  PostgresFile,
  PostgresFileRecord,
  translateApiGranuleToPostgresGranuleWithoutNilsRemoved,
  createRejectableTransaction,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import {
  InvalidArgument,
  PostgresUpdateFailed,
  RecordAlreadyMigrated,
  RecordDoesNotExist,
} from '@cumulus/errors';
import {
  GranuleMigrationParams,
  GranulesMigrationResult,
  MigrationResult,
} from '@cumulus/types/migration';

import { ApiGranuleRecord } from '@cumulus/types/api/granules';

import { closeErrorWriteStreams, createErrorFileWriteStream, storeErrors } from './storeErrors';

import { initialMigrationResult } from './common';

const { getBucket, getKey } = require('@cumulus/api/lib/FileUtils');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const logger = new Logger({ sender: '@cumulus/data-migration/granules' });

export interface GranulesAndFilesMigrationResult {
  granulesResult: GranulesMigrationResult,
  filesResult: MigrationResult,
}

const initializeGranulesAndFilesMigrationResult = (): GranulesAndFilesMigrationResult => {
  const granuleMigrationResult: GranulesMigrationResult = cloneDeep(initialMigrationResult);
  const fileMigrationResult: MigrationResult = cloneDeep(initialMigrationResult);
  return {
    granulesResult: granuleMigrationResult,
    filesResult: fileMigrationResult,
  };
};

/**
 * Migrate granules record from Dynamo to Postgres.
 *
 * @param {Object} record
 *   Record from DynamoDB
 * @param {Knex.Transaction} trx
 *  - Knex transaction
 * @param {Object} migrationParams
 *   - Migration parameters
 * @param {string} migrationParams.migrateAndOverwrite
 *  - true/false parameter, set to 'true' to have the granule migration
 *    overwrite existing dynamo *granule* records if there are any.
 *    Set to 'false' to 'skip' migration when there's an existing granule record in
 *    PostgreSQL
 * @param {string} migrationParams.migrateOnlyFiles
 *   - true/false parameter, set to 'true' to return the granule.cumulus_id
 *     or throw if it doesn't exist Set to 'false' to migrate granule record data as normal.
 * @returns {Promise<any>}
 * @throws {RecordAlreadyMigrated}
 *   - If record was already migrated
 * @throws {PostgresUpdateFailed}
 *   - If the granule upsert effected 0 rows
 */
export const migrateGranuleRecord = async (
  record: { [key: string]: NativeAttributeValue },
  trx: Knex.Transaction,
  migrationParams: {
    migrateAndOverwrite: string,
    migrateOnlyFiles: string
  } = { migrateAndOverwrite: 'false', migrateOnlyFiles: 'false' }
): Promise<number> => {
  const { migrateAndOverwrite, migrateOnlyFiles } = migrationParams;
  const { name, version } = deconstructCollectionId(record.collectionId);
  const collectionPgModel = new CollectionPgModel();
  const executionPgModel = new ExecutionPgModel();
  const granulePgModel = new GranulePgModel();

  const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
    trx,
    { name, version }
  );

  // It's possible that executions may not exist in PG because they
  // don't exist in DynamoDB, so were never migrated to PG. We DO NOT
  // fail granule migration if execution cannot be found.
  let executionCumulusId: number | undefined;
  try {
    if (record.execution) {
      executionCumulusId = await executionPgModel.getRecordCumulusId(
        trx,
        {
          url: record.execution,
        }
      );
    } else {
      logger.warn('Migration of granule ID %j linked no executions as record did not have an ARN associated with it', record.granuleId);
    }
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    } else {
      logger.warn(`Migration of granule ID ${record.granuleId} linked no executions as execution ${record.execution} does not exist in the postGreSQL database`);
    }
  }

  let existingRecord;

  if (migrateAndOverwrite !== 'true') {
    let recordCheckError;
    try {
      existingRecord = await granulePgModel.get(trx, {
        granule_id: record.granuleId,
        collection_cumulus_id: collectionCumulusId,
      });
    } catch (error) {
      if (!(error instanceof RecordDoesNotExist)) {
        throw error;
      }
      recordCheckError = error;
    }

    if (migrateOnlyFiles === 'true') {
      if (!existingRecord) {
        throw recordCheckError;
      }
      return existingRecord.cumulus_id;
    }

    const isExistingRecordNewer = existingRecord
      && existingRecord.updated_at >= new Date(record.updatedAt);

    if (isExistingRecordNewer) {
      throw new RecordAlreadyMigrated(`Granule ${record.granuleId} was already migrated, skipping`);
    }
  }

  if (migrateOnlyFiles === 'true') {
    throw new InvalidArgument('Invalid migration parameters detected, migrateOnlyFiles cannot be set to true if migrateAndOverwrite is also set to true');
  }

  const granule = await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: record as ApiGranuleRecord,
    knexOrTransaction: trx,
  });

  const [pgGranuleRecord] = await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: trx,
    granule,
    executionCumulusId,
  });

  if (!pgGranuleRecord) {
    throw new PostgresUpdateFailed(`Upsert for granule ${record.granuleId} returned no rows. Record was not updated in the Postgres table.`);
  }

  return pgGranuleRecord.cumulus_id;
};

/**
 * Migrate File record from a Granules record from DynamoDB  to RDS.
 *
 * @param {ApiFile} file            - Granule file
 * @param {number} granuleCumulusId - ID of granule
 * @param {Knex.Transaction} trx    - Knex transaction
 * @returns {Promise<PostgresFileRecord>}
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migrateFileRecord = async (
  file: ApiFile,
  granuleCumulusId: number,
  trx: Knex.Transaction
): Promise<PostgresFileRecord> => {
  const filePgModel = new FilePgModel();

  const bucket = getBucket(file);
  const key = getKey(file);

  // Map old record to new schema.
  const updatedRecord: PostgresFile = {
    bucket,
    key,
    granule_cumulus_id: granuleCumulusId,
    file_size: file.size,
    checksum_value: file.checksum,
    checksum_type: file.checksumType,
    file_name: file.fileName,
    source: file.source,
    path: file.path,
    type: file.type,
  };
  const [writtenFile] = await filePgModel.upsert(trx, updatedRecord);
  return writtenFile;
};

/**
* Removes excess files from the postgres database for a given granule
*
* @summary Given a list of postgres file objects, remove all other file objects
* from the postgres database for the provided granuleCumulusId
* @param {Object} params - Paramter object
* @param {[PostgresFileRecord]} params.writtenFiles - List of postgres file objects that should
* not be removed by this method.
* @param {number} params.granuleCumulusId - postgres granule_cumulus_id
* @param {Object} params.knexOrTransaction - Instance of a Knex client or transaction
* @returns {Promise<number>} The number of rows deleted
*/
const removeExcessFiles = async (params: {
  writtenFiles: PostgresFileRecord[],
  granuleCumulusId: number,
  knexOrTransaction: Knex | Knex.Transaction
}): Promise<number> => {
  const {
    writtenFiles,
    granuleCumulusId,
    knexOrTransaction,
  } = params;
  const filePgModel = new FilePgModel();
  const excludeCumulusIds = writtenFiles.map((file) => file.cumulus_id);
  return await filePgModel.deleteExcluding({
    knexOrTransaction: knexOrTransaction,
    queryParams: { granule_cumulus_id: granuleCumulusId },
    excludeCumulusIds,
  });
};

/**
 * Migrate granule and files from DynamoDB to RDS
 * @param {Object} params
 * @param {Object} params.dynamoRecord
 * @param {GranulesAndFilesMigrationSummary} params.granuleAndFileMigrationSummary
 * @param {Knex} params.knex
 * @param {number} params.loggingInterval
 * @param {Writable} params.errorLogWriteStream
 * @returns {Promise<MigrationSummary>} - Migration summary for granules and files
 */
export const migrateGranuleAndFilesViaTransaction = async (params: {
  dynamoRecord: { [key: string]: NativeAttributeValue },
  granuleAndFilesMigrationResult: GranulesAndFilesMigrationResult,
  knex: Knex,
  loggingInterval: number,
  errorLogWriteStream: Writable,
  migrateAndOverwrite: string,
  migrateOnlyFiles: string,
}): Promise<GranulesAndFilesMigrationResult> => {
  const {
    dynamoRecord,
    errorLogWriteStream,
    granuleAndFilesMigrationResult,
    knex,
    loggingInterval,
    migrateAndOverwrite,
    migrateOnlyFiles,
  } = params;
  const files = dynamoRecord.files ?? [];
  const migrationResult = granuleAndFilesMigrationResult
    ?? initializeGranulesAndFilesMigrationResult();
  const { granulesResult, filesResult } = migrationResult;

  granulesResult.total_dynamo_db_records += 1;
  filesResult.total_dynamo_db_records += files.length;

  if (granulesResult.total_dynamo_db_records % loggingInterval === 0) {
    logger.info(`Batch of ${loggingInterval} granule records processed, ${granulesResult.total_dynamo_db_records} total`);
  }

  try {
    let writtenFiles: PostgresFileRecord[] = [];
    await createRejectableTransaction(knex, async (trx: Knex.Transaction) => {
      const granuleCumulusId = await migrateGranuleRecord(dynamoRecord, trx, {
        migrateAndOverwrite,
        migrateOnlyFiles,
      });

      writtenFiles = await Promise.all(files.map(
        (file : ApiFile) => migrateFileRecord(file, granuleCumulusId, trx)
      ));

      await removeExcessFiles({
        writtenFiles,
        granuleCumulusId,
        knexOrTransaction: trx,
      });
    });

    granulesResult.migrated += 1;
    filesResult.migrated += writtenFiles.length;
    // not counting/reporting removedFiles
  } catch (error) {
    if (error instanceof RecordAlreadyMigrated) {
      granulesResult.skipped += 1;
      filesResult.skipped += files.length;
    } else {
      const errorMessage = `Could not create granule record and file records in RDS for DynamoDB Granule granuleId: ${dynamoRecord.granuleId} with files ${JSON.stringify(dynamoRecord.files)}`;
      granulesResult.failed += 1;
      filesResult.failed += files.length;

      errorLogWriteStream.write(`${errorMessage}, Cause: ${error}`);
      logger.error(errorMessage, error);
    }
  }

  return { granulesResult, filesResult };
};

const migrateGranuleDynamoRecords = async (
  items: ScanCommandOutput['Items'] = [],
  migrationResult: GranulesAndFilesMigrationResult,
  knex: Knex,
  loggingInterval: number,
  writeConcurrency: number,
  errorLogWriteStream: Writable,
  migrateAndOverwrite: string,
  migrateOnlyFiles: string
) => {
  const updatedResult = migrationResult;
  await pMap(
    items,
    async (dynamoRecord) => {
      const result = await migrateGranuleAndFilesViaTransaction({
        dynamoRecord,
        granuleAndFilesMigrationResult: migrationResult,
        knex,
        loggingInterval,
        errorLogWriteStream,
        migrateAndOverwrite,
        migrateOnlyFiles,
      });
      updatedResult.granulesResult = result.granulesResult;
      updatedResult.filesResult = result.filesResult;
    },
    {
      concurrency: writeConcurrency,
    }
  );
};

/**
 * Query DynamoDB for granule records and migrate them to granule/file records in PostgreSQL.
 *
 * Performs a DynamoDb query() operation instead of a scan(), which will select only a subset
 * of records from the table based on the supplied filters and is more efficient than scanning
 * the whole table.
 *
 * @param {Object} params
 * @param {string} params.granulesTable - Name of DynamoDB table for granules
 * @param {GranuleMigrationParams} params.granuleMigrationParams
 *   Parameters to control data selected for migration
 * @param {string} params.granuleMigrationParams.granuleId
 *   Granule ID to use for querying granules to migrate
 * @param {string} params.granuleMigrationParams.collectionId
 *   Collection name/version to use for querying granules to migrate
 * @param {GranulesAndFilesMigrationResult} params.granulesAndFilesMigrationResult
 *   Result summary of the migration to be updated
 * @param {Knex} params.knex - Instance of a database client
 * @param {number} params.loggingInterval
 *   Sets the interval number of records when a log message will be written on migration progress
 * @param {number} params.jsonWriteStream
 *   JSON Write stream for error logs
 * @returns {Promise<GranulesAndFilesMigrationResult>}
 *   Result object summarizing the granule/files migration
 */
export const queryAndMigrateGranuleDynamoRecords = async ({
  granulesTable,
  granuleMigrationParams,
  granulesAndFilesMigrationResult,
  knex,
  loggingInterval,
  jsonWriteStream,
}: {
  granulesTable: string,
  granuleMigrationParams: GranuleMigrationParams,
  granulesAndFilesMigrationResult?: GranulesAndFilesMigrationResult,
  knex: Knex,
  loggingInterval: number,
  jsonWriteStream: Writable,
}) => {
  const migrationResult = granulesAndFilesMigrationResult
    ?? initializeGranulesAndFilesMigrationResult();

  let extraQueryParams = {};
  if (granuleMigrationParams.granuleId) {
    migrationResult.granulesResult.filters = {
      granuleId: granuleMigrationParams.granuleId,
    };
    extraQueryParams = {
      KeyConditionExpression: 'granuleId = :granuleId',
      ExpressionAttributeValues: {
        ':granuleId': granuleMigrationParams.granuleId,
      },
    };
  } else if (granuleMigrationParams.collectionId) {
    migrationResult.granulesResult.filters = {
      collectionId: granuleMigrationParams.collectionId,
    };
    extraQueryParams = {
      IndexName: 'collectionId-granuleId-index',
      KeyConditionExpression: 'collectionId = :collectionId',
      ExpressionAttributeValues: {
        ':collectionId': granuleMigrationParams.collectionId,
      },
    };
  }

  const searchQueue = new DynamoDbSearchQueue(
    {
      TableName: granulesTable,
      ...extraQueryParams,
    },
    'query'
  );

  let dynamoRecord = await searchQueue.peek();

  /* eslint-disable no-await-in-loop */
  while (dynamoRecord) {
    const result = await migrateGranuleAndFilesViaTransaction({
      dynamoRecord,
      granuleAndFilesMigrationResult: migrationResult,
      knex,
      loggingInterval,
      errorLogWriteStream: jsonWriteStream,
      migrateAndOverwrite: granuleMigrationParams.migrateAndOverwrite || 'false',
      migrateOnlyFiles: granuleMigrationParams.migrateOnlyFiles || 'false',
    });
    migrationResult.granulesResult = result.granulesResult;
    migrationResult.filesResult = result.filesResult;

    await searchQueue.shift();
    dynamoRecord = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */

  return migrationResult;
};

const normalizeBoolParam = (name: string, paramValue: string) => {
  const returnParam = paramValue.toLowerCase();
  if (!(['true', 'false'].includes(returnParam))) {
    throw new InvalidArgument(`${name} must be either true or false`);
  }
  return returnParam;
};

/**
 * Query DynamoDB for granule records to create granule/file records in PostgreSQL.
 *
 * @param {NodeJS.ProcessEnv} env - Environment variables which may contain configuration
 * @param {number} env.loggingInterval
 *   Sets the interval number of records when a log message will be written on migration progress
 * @param {Knex} knex - Instance of a database client
 * @param {GranuleMigrationParams} granuleMigrationParams
 *   Parameters to control data selected for migration
 * @param {string} granuleMigrationParams.granuleId
 *   Granule ID to use for querying granules to migrate
 * @param {string} granuleMigrationParams.collectionId
 *   Collection name/version to use for querying granules to migrate
 * @param {string | undefined} testTimestamp
 *   Timestamp to use for unit testing
 * @returns {Promise<GranulesAndFilesMigrationResult>}
 *   Result object summarizing the granule/files migration
 */
export const migrateGranulesAndFiles = async (
  env: NodeJS.ProcessEnv,
  knex: Knex,
  granuleMigrationParams: GranuleMigrationParams = {},
  testTimestamp?: string
): Promise<GranulesAndFilesMigrationResult> => {
  const bucket = envUtils.getRequiredEnvVar('system_bucket', env);
  const granulesTable = envUtils.getRequiredEnvVar('GranulesTable', env);
  const stackName = envUtils.getRequiredEnvVar('stackName', env);

  const migrateAndOverwrite = normalizeBoolParam('migrateAndOverwrite', (granuleMigrationParams.migrateAndOverwrite ?? 'false'));
  const migrateOnlyFiles = normalizeBoolParam('migrateOnlyFiles', (granuleMigrationParams.migrateOnlyFiles ?? 'false'));
  const loggingInterval = granuleMigrationParams.loggingInterval ?? 100;
  const writeConcurrency = granuleMigrationParams.writeConcurrency ?? 10;
  const granulesAndFilesMigrationResult = initializeGranulesAndFilesMigrationResult();

  if (migrateAndOverwrite === 'true' && migrateOnlyFiles === 'true') {
    throw new InvalidArgument('Invalid migration parameters detected, migrateOnlyFiles cannot be set to true if migrateAndOverwrite is also set to true');
  }

  const migrationName = 'granulesAndFiles';
  const {
    errorFileWriteStream,
    jsonWriteStream,
    filepath,
  } = createErrorFileWriteStream(migrationName, testTimestamp);

  const doDynamoQuery = granuleMigrationParams.granuleId !== undefined
    || granuleMigrationParams.collectionId !== undefined;

  if (doDynamoQuery) {
    await queryAndMigrateGranuleDynamoRecords({
      granulesTable,
      granuleMigrationParams,
      granulesAndFilesMigrationResult,
      knex,
      loggingInterval,
      jsonWriteStream,
    });
  } else {
    const totalSegments = granuleMigrationParams.parallelScanSegments ?? 20;

    logger.info(`Starting parallel scan of granules with ${totalSegments} parallel segments`);

    await parallelScan({
      dynamoDbClient: dynamodbDocClient({
        marshallOptions: {
          convertEmptyValues: true,
          removeUndefinedValues: true,
        },
      }),
      totalSegments,
      scanParams: {
        TableName: granulesTable,
        Limit: granuleMigrationParams.parallelScanLimit,
      },
      processItemsFunc: (items) => migrateGranuleDynamoRecords(
        items,
        granulesAndFilesMigrationResult,
        knex,
        loggingInterval,
        writeConcurrency,
        jsonWriteStream,
        migrateAndOverwrite,
        migrateOnlyFiles
      ),
    });
    logger.info(`Finished parallel scan of granules with ${totalSegments} parallel segments.`);
  }
  await closeErrorWriteStreams({ errorFileWriteStream, jsonWriteStream });
  await storeErrors({
    bucket,
    filepath,
    migrationName,
    stackName,
    timestamp: testTimestamp,
  });

  logger.info(`Successfully migrated ${granulesAndFilesMigrationResult.granulesResult.migrated} granule records.`);
  logger.info(`Successfully migrated ${granulesAndFilesMigrationResult.filesResult.migrated} file records.`);
  return granulesAndFilesMigrationResult;
};

import Knex from 'knex';
import pMap from 'p-map';
import cloneDeep from 'lodash/cloneDeep';

import { parallelScan } from '@cumulus/aws-client/DynamoDb';
import Logger from '@cumulus/logger';
import {
  CollectionPgModel,
  ExecutionPgModel,
  PdrPgModel,
  PostgresPdr,
  ProviderPgModel,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import {
  RecordAlreadyMigrated,
  RecordDoesNotExist,
  PostgresUpdateFailed,
} from '@cumulus/errors';

import { MigrationResult, ParallelScanMigrationParams } from '@cumulus/types/migration';

import { initialMigrationResult } from './common';

const logger = new Logger({ sender: '@cumulus/data-migration/pdrs' });
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');

/**
 * Migrate PDR record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoPDR
 *   PDR Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 * @throws {PostgresUpdateFailed} if the upsert effected 0 rows
 */
export const migratePdrRecord = async (
  dynamoPDR: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  const { name, version } = deconstructCollectionId(dynamoPDR.collectionId);
  const collectionPgModel = new CollectionPgModel();
  const executionPgModel = new ExecutionPgModel();
  const pdrPgModel = new PdrPgModel();
  const providerPgModel = new ProviderPgModel();

  let existingRecord;

  try {
    existingRecord = await pdrPgModel.get(knex, { name: dynamoPDR.pdrName });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  const isExistingRecordNewer = existingRecord
    && existingRecord.updated_at >= new Date(dynamoPDR.updatedAt);

  if (isExistingRecordNewer) {
    throw new RecordAlreadyMigrated(`PDR name ${dynamoPDR.pdrName} was already migrated, skipping.`);
  }

  const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
    knex,
    { name, version }
  );

  const providerCumulusId = await providerPgModel.getRecordCumulusId(
    knex,
    { name: dynamoPDR.provider }
  );

  const executionCumulusId = dynamoPDR.execution
    ? await executionPgModel.getRecordCumulusId(
      knex,
      { url: dynamoPDR.execution }
    )
    : undefined;

  // Map old record to new schema.
  const updatedRecord: PostgresPdr = {
    name: dynamoPDR.pdrName,
    provider_cumulus_id: providerCumulusId,
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
    status: dynamoPDR.status,
    progress: dynamoPDR.progress,
    pan_sent: dynamoPDR.PANSent,
    pan_message: dynamoPDR.PANmessage,
    stats: dynamoPDR.stats,
    address: dynamoPDR.address,
    original_url: dynamoPDR.originalUrl,
    timestamp: dynamoPDR.timestamp ? new Date(dynamoPDR.timestamp) : undefined,
    duration: dynamoPDR.duration,
    created_at: new Date(dynamoPDR.createdAt),
    updated_at: dynamoPDR.updatedAt ? new Date(dynamoPDR.updatedAt) : undefined,
  };

  const [cumulusId] = await pdrPgModel.upsert(knex, updatedRecord);

  if (!cumulusId) {
    throw new PostgresUpdateFailed(`Upsert for PDR ${dynamoPDR.pdrName} returned no rows. Record was not updated in the Postgres table.`);
  }
};

export const migratePdrDynamoRecords = async (
  items: AWS.DynamoDB.DocumentClient.AttributeMap[],
  migrationResult: MigrationResult,
  knex: Knex,
  loggingInterval: number,
  writeConcurrency: number
) => {
  const updatedResult = migrationResult;
  await pMap(
    items,
    async (dynamoPDR) => {
      updatedResult.total_dynamo_db_records += 1;

      if (updatedResult.total_dynamo_db_records % loggingInterval === 0) {
        logger.info(`Batch of ${loggingInterval} PDR records processed, ${updatedResult.total_dynamo_db_records} total`);
      }
      try {
        await migratePdrRecord(dynamoPDR, knex);
        updatedResult.migrated += 1;
      } catch (error) {
        if (error instanceof RecordAlreadyMigrated) {
          updatedResult.skipped += 1;
        } else {
          updatedResult.failed += 1;
          logger.error(
            `Could not create PDR record in RDS for Dynamo PDR name: ${dynamoPDR.pdrName}`,
            error
          );
        }
      }
    },
    {
      stopOnError: false,
      concurrency: writeConcurrency,
    }
  );
};

export const migratePdrs = async (
  env: NodeJS.ProcessEnv,
  knex: Knex,
  pdrMigrationParams: ParallelScanMigrationParams = {}
): Promise<MigrationResult> => {
  const pdrsTable = envUtils.getRequiredEnvVar('PdrsTable', env);

  const loggingInterval = pdrMigrationParams.loggingInterval ?? 100;
  const totalSegments = pdrMigrationParams.parallelScanSegments ?? 20;
  const writeConcurrency = pdrMigrationParams.writeConcurrency ?? 10;

  const migrationResult = cloneDeep(initialMigrationResult);

  logger.info(`Starting parallel scan of PDRs with ${totalSegments} parallel segments`);

  await parallelScan({
    totalSegments,
    scanParams: {
      TableName: pdrsTable,
      Limit: pdrMigrationParams.parallelScanLimit,
    },
    processItemsFunc: (items) => migratePdrDynamoRecords(
      items,
      migrationResult,
      knex,
      loggingInterval,
      writeConcurrency
    ),
  });

  logger.info(`Finished parallel scan of PDRs with ${totalSegments} parallel segments.`);
  logger.info(`successfully migrated ${migrationResult.migrated} out of ${migrationResult.total_dynamo_db_records} PDR records`);
  return migrationResult;
};

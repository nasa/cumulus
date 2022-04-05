import { Knex } from 'knex';
import pMap from 'p-map';
import cloneDeep from 'lodash/cloneDeep';
import {
  ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';

import { parallelScan } from '@cumulus/aws-client/DynamoDb';
import { dynamodbDocClient } from '@cumulus/aws-client/services';
import Logger from '@cumulus/logger';
import {
  PdrPgModel,
  translateApiPdrToPostgresPdr,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import {
  RecordAlreadyMigrated,
  RecordDoesNotExist,
  PostgresUpdateFailed,
} from '@cumulus/errors';
import { ApiPdrRecord } from '@cumulus/types/api/pdrs';

import { MigrationResult, ParallelScanMigrationParams } from '@cumulus/types/migration';

import { initialMigrationResult } from './common';

const logger = new Logger({ sender: '@cumulus/data-migration/pdrs' });

/**
 * Migrate PDR record from Dynamo to RDS.
 *
 * @param {Object} dynamoPDR
 *   PDR Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 * @throws {PostgresUpdateFailed} if the upsert effected 0 rows
 */
export const migratePdrRecord = async (
  dynamoPDR: ApiPdrRecord,
  knex: Knex
): Promise<void> => {
  const pdrPgModel = new PdrPgModel();

  let existingRecord;

  try {
    existingRecord = await pdrPgModel.get(knex, { name: dynamoPDR.pdrName });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  const isExistingRecordNewer = existingRecord && dynamoPDR.updatedAt
    && existingRecord.updated_at >= new Date(dynamoPDR.updatedAt);

  if (isExistingRecordNewer) {
    throw new RecordAlreadyMigrated(`PDR name ${dynamoPDR.pdrName} was already migrated, skipping.`);
  }

  // Map old record to new schema.
  const updatedRecord = await translateApiPdrToPostgresPdr(
    dynamoPDR,
    knex
  );

  const [cumulusId] = await pdrPgModel.upsert(knex, updatedRecord);

  if (!cumulusId) {
    throw new PostgresUpdateFailed(`Upsert for PDR ${dynamoPDR.pdrName} returned no rows. Record was not updated in the Postgres table.`);
  }
};

export const migratePdrDynamoRecords = async (
  items: ScanCommandOutput['Items'] = [],
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
        await migratePdrRecord(<ApiPdrRecord>dynamoPDR, knex);
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
    dynamoDbClient: dynamodbDocClient({
      marshallOptions: {
        convertEmptyValues: true,
        removeUndefinedValues: true,
      },
    }),
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

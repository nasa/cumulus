import { Knex } from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { envUtils } from '@cumulus/common';
import {
  ReconciliationReportPgModel,
  translateApiReconReportToPostgresReconReport,
} from '@cumulus/db';
import { ApiReconciliationReport } from '@cumulus/types/api/reconciliation-reports';
import Logger from '@cumulus/logger';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';

import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/reconciliation-reports' });

export const migrateReconciliationReportRecord = async (
  dynamoRecord: ApiReconciliationReport,
  knex: Knex
): Promise<void> => {
  const reconReportPgModel = new ReconciliationReportPgModel();

  let existingRecord;

  try {
    existingRecord = await reconReportPgModel.get(knex, { name: dynamoRecord.name });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  if (existingRecord
    && dynamoRecord.updatedAt
    && existingRecord.updated_at >= new Date(dynamoRecord.updatedAt)) {
    throw new RecordAlreadyMigrated(`Async Operation ${dynamoRecord.name} was already migrated, skipping`);
  }

  const updatedRecord = translateApiReconReportToPostgresReconReport(
    <ApiReconciliationReport>dynamoRecord
  );

  await reconReportPgModel.upsert(knex, updatedRecord);
};

export const migrateReconciliationReports = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const reconciliationReportsTable = envUtils.getRequiredEnvVar('ReconciliationReportsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: reconciliationReportsTable,
  });

  const migrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while (record) {
    migrationSummary.dynamoRecords += 1;

    try {
      const apiRecord = unmarshall(record) as ApiReconciliationReport;
      await migrateReconciliationReportRecord(apiRecord, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create reconciliationReport record in RDS for Dynamo reconciliationReport name ${record.name}:`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${migrationSummary.success} reconciliationReport records`);
  return migrationSummary;
};

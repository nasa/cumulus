import { Knex } from 'knex';

import { DynamoDbSearchQueue } from '@cumulus/aws-client';
import { envUtils } from '@cumulus/common';
import {
  ReconciliationReportPgModel,
  translateApiReconReportToPostgresReconReport,
} from '@cumulus/db';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';
import Logger from '@cumulus/logger';
import { ApiReconciliationReportRecord } from '@cumulus/types/api/reconciliation_reports';

import { MigrationResult } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/reconciliation-reports' });

export const migrateReconciliationReportRecord = async (
  dynamoRecord: ApiReconciliationReportRecord,
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
    throw new RecordAlreadyMigrated(`Reconciliation report ${dynamoRecord.name} was already migrated, skipping`);
  }

  const updatedRecord = translateApiReconReportToPostgresReconReport(
    <ApiReconciliationReportRecord>dynamoRecord
  );

  await reconReportPgModel.upsert(knex, updatedRecord);
};

export const migrateReconciliationReports = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationResult> => {
  const reconciliationReportsTable = envUtils.getRequiredEnvVar('ReconciliationReportsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: reconciliationReportsTable,
  });

  const migrationSummary = {
    total_dynamo_db_records: 0,
    migrated: 0,
    failed: 0,
    skipped: 0,
  };

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while (record) {
    migrationSummary.total_dynamo_db_records += 1;

    try {
      await migrateReconciliationReportRecord(record as any, knex);
      migrationSummary.migrated += 1;
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
  logger.info(`successfully migrated ${migrationSummary.migrated} reconciliationReport records`);
  return migrationSummary;
};

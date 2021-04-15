import { getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';
import {
  DataMigration2Summary,
  DataMigration2HandlerEvent,
  MigrationSummary,
} from '@cumulus/types/migration';

import { migrateExecutions } from './executions';
import { migrateGranulesAndFiles } from './granulesAndFiles';
import { migratePdrs } from './pdrs';

const logger = new Logger({ sender: '@cumulus/data-migration2' });

export const handler = async (
  event: DataMigration2HandlerEvent
): Promise<MigrationSummary> => {
  const env = event.env ?? process.env;
  const migrationsToRun = event.migrationsList ?? ['executions', 'granules', 'pdrs'];

  const knex = await getKnexClient({ env });

  try {
    const migrationSummary: DataMigration2Summary = {};

    if (migrationsToRun.includes('executions')) {
      const executionsMigrationResult = await migrateExecutions(
        env,
        knex,
        event.executionMigrationParams
      );
      migrationSummary.executions = {
        total_dynamo_db_records: executionsMigrationResult.total_dynamo_db_records,
        migrated: executionsMigrationResult.migrated,
        skipped: executionsMigrationResult.skipped,
        failed: executionsMigrationResult.failed,
      };
    }

    if (migrationsToRun.includes('granules')) {
      const { granulesResult, filesResult } = await migrateGranulesAndFiles(
        env,
        knex,
        event.granuleMigrationParams
      );
      migrationSummary.granules = {
        total_dynamo_db_records: granulesResult.total_dynamo_db_records,
        migrated: granulesResult.migrated,
        skipped: granulesResult.skipped,
        failed: granulesResult.failed,
      };
      migrationSummary.files = {
        total_dynamo_db_records: granulesResult.total_dynamo_db_records,
        migrated: filesResult.migrated,
        skipped: filesResult.skipped,
        failed: filesResult.failed,
      };
    }

    if (migrationsToRun.includes('pdrs')) {
      const pdrsMigrationResult = await migratePdrs(env, knex);
      migrationSummary.pdrs = {
        total_dynamo_db_records: pdrsMigrationResult.total_dynamo_db_records,
        migrated: pdrsMigrationResult.migrated,
        skipped: pdrsMigrationResult.skipped,
        failed: pdrsMigrationResult.failed,
      };
    }

    const summary: MigrationSummary = {
      MigrationSummary: migrationSummary,
    };
    logger.info(JSON.stringify(summary));
    return summary;
  } finally {
    await knex.destroy();
  }
};

import { getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';
import { DataMigration2, MigrationSummary } from '@cumulus/types/migration';
import { DataMigration2HandlerEvent } from '@cumulus/types/migrations';

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
    const migrationSummary: DataMigration2 = {};

    if (migrationsToRun.includes('executions')) {
      const executionsMigrationSummary = await migrateExecutions(env, knex);
      migrationSummary.executions = {
        total_dynamo_db_records: executionsMigrationSummary.dynamoRecords,
        migrated: executionsMigrationSummary.success,
        skipped: executionsMigrationSummary.skipped,
        failed: executionsMigrationSummary.failed,
      };
    }

    if (migrationsToRun.includes('granules')) {
      const granulesAndFilesMigrationSummary = await migrateGranulesAndFiles(
        env,
        knex,
        event.granuleSearchParams
      );
      migrationSummary.granules = {
        total_dynamo_db_records: granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords,
        migrated: granulesAndFilesMigrationSummary.granulesSummary.success,
        skipped: granulesAndFilesMigrationSummary.granulesSummary.skipped,
        failed: granulesAndFilesMigrationSummary.granulesSummary.failed,
      };
      migrationSummary.files = {
        total_dynamo_db_records: granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords,
        migrated: granulesAndFilesMigrationSummary.filesSummary.success,
        skipped: granulesAndFilesMigrationSummary.filesSummary.skipped,
        failed: granulesAndFilesMigrationSummary.filesSummary.failed,
      };
    }

    if (migrationsToRun.includes('pdrs')) {
      const pdrsMigrationSummary = await migratePdrs(env, knex);
      migrationSummary.pdrs = {
        total_dynamo_db_records: pdrsMigrationSummary.dynamoRecords,
        migrated: pdrsMigrationSummary.success,
        skipped: pdrsMigrationSummary.skipped,
        failed: pdrsMigrationSummary.failed,
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

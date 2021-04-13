import { getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';
import { DataMigration2HandlerEvent } from '@cumulus/types/migrations';

import { migrateExecutions } from './executions';
import { migrateGranulesAndFiles } from './granulesAndFiles';
import { migratePdrs } from './pdrs';

const logger = new Logger({ sender: '@cumulus/data-migration2' });

export const handler = async (
  event: DataMigration2HandlerEvent
): Promise<string> => {
  const env = event.env ?? process.env;
  const migrationsToRun = event.migrationsList ?? ['executions', 'granules', 'pdrs'];

  const knex = await getKnexClient({ env });

  try {
    let summary = `
      Migration summary:
    `;

    if (migrationsToRun.includes('executions')) {
      const executionsMigrationSummary = await migrateExecutions(env, knex);
      summary += `
        Executions:
          Out of ${executionsMigrationSummary.dynamoRecords} DynamoDB records:
            ${executionsMigrationSummary.success} records migrated
            ${executionsMigrationSummary.skipped} records skipped
            ${executionsMigrationSummary.failed} records failed
      `;
    }

    if (migrationsToRun.includes('granules')) {
      const granulesAndFilesMigrationSummary = await migrateGranulesAndFiles(
        env,
        knex,
        event.granuleSearchParams
      );
      summary += `
        Granules:
          Out of ${granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords} DynamoDB records:
            ${granulesAndFilesMigrationSummary.granulesSummary.success} records migrated
            ${granulesAndFilesMigrationSummary.granulesSummary.skipped} records skipped
            ${granulesAndFilesMigrationSummary.granulesSummary.failed} records failed
          Files:
            Out of ${granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords} DynamoDB records:
              ${granulesAndFilesMigrationSummary.filesSummary.success} records migrated
              ${granulesAndFilesMigrationSummary.filesSummary.failed} records failed
      `;
    }

    if (migrationsToRun.includes('pdrs')) {
      const pdrsMigrationSummary = await migratePdrs(env, knex);
      summary += `
        PDRs:
          Out of ${pdrsMigrationSummary.dynamoRecords} DynamoDB records:
            ${pdrsMigrationSummary.success} records migrated
            ${pdrsMigrationSummary.skipped} records skipped
            ${pdrsMigrationSummary.failed} records failed
      `;
    }

    logger.info(summary);
    return summary;
  } finally {
    await knex.destroy();
  }
};

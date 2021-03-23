import { getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';

import { migrateExecutions } from './executions';
import { migrateGranulesAndFiles } from './granulesAndFiles';
import { migratePdrs } from './pdrs';

const logger = new Logger({ sender: '@cumulus/data-migration2' });
export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<string> => {
  const env = event.env ?? process.env;

  const knex = await getKnexClient({ env });

  try {
    const executionsMigrationSummary = await migrateExecutions(env, knex);
    const granulesAndFilesMigrationSummary = await migrateGranulesAndFiles(env, knex);
    const pdrsMigrationSummary = await migratePdrs(env, knex);

    const summary = `
      Migration summary:
        Executions:
          Out of ${executionsMigrationSummary.dynamoRecords} DynamoDB records:
            ${executionsMigrationSummary.success} records migrated
            ${executionsMigrationSummary.skipped} records skipped
            ${executionsMigrationSummary.failed} records failed
        Granules:
          Out of ${granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords} DynamoDB records:
            ${granulesAndFilesMigrationSummary.granulesSummary.success} records migrated
            ${granulesAndFilesMigrationSummary.granulesSummary.skipped} records skipped
            ${granulesAndFilesMigrationSummary.granulesSummary.failed} records failed
        Files:
          Out of ${granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords} DynamoDB records:
            ${granulesAndFilesMigrationSummary.filesSummary.success} records migrated
            ${granulesAndFilesMigrationSummary.filesSummary.failed} records failed
        PDRs:
          Out of ${pdrsMigrationSummary.dynamoRecords} DynamoDB records:
            ${pdrsMigrationSummary.success} records migrated
            ${pdrsMigrationSummary.skipped} records skipped
            ${pdrsMigrationSummary.failed} records failed
    `;
    logger.info(summary);
    return summary;
  } finally {
    await knex.destroy();
  }
};

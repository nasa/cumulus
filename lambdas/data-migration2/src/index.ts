import { getKnexClient } from '@cumulus/db';

import { migrateExecutions } from './executions';
import { migrateGranulesAndFiles } from './granulesAndFiles';

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<string> => {
  const env = event.env ?? process.env;

  const knex = await getKnexClient({ env });

  try {
    const executionsMigrationSummary = await migrateExecutions(env, knex);
    const granulesAndFilesMigrationSummary = await migrateGranulesAndFiles(env, knex);

    return `
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
    `;
  } finally {
    await knex.destroy();
  }
};

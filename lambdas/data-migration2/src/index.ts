import { getKnexClient } from '@cumulus/db';

import { migrateExecutions } from './executions';

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<string> => {
  const env = event.env ?? process.env;

  const knex = await getKnexClient({ env });

  try {
    const executionsMigrationSummary = await migrateExecutions();

    return `
      Migration summary:
        Executions:
          Out of ${executionsMigrationSummary.dynamoRecords} DynamoDB records:
            ${executionsMigrationSummary.success} records migrated
            ${executionsMigrationSummary.skipped} records skipped
            ${executionsMigrationSummary.failed} records failed
    `;
  } finally {
    await knex.destroy();
  }
};

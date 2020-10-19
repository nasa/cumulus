import { getKnexClient } from '@cumulus/db';

import { migrateCollections } from './collections';
import { migrateProviders } from './providers';

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<string> => {
  const env = event.env ?? process.env;

  const knex = await getKnexClient({ env });

  try {
    const collectionsMigrationSummary = await migrateCollections(env, knex);
    const providersMigrationSummary = await migrateProviders(env, knex);
    return `
      Migration summary:
        Collections:
          Out of ${collectionsMigrationSummary.dynamoRecords} Dynamo records:
            ${collectionsMigrationSummary.success} records migrated
            ${collectionsMigrationSummary.skipped} records skipped
            ${collectionsMigrationSummary.failed} records failed
        Providers:
          Out of ${providersMigrationSummary.dynamoRecords} Dynamo records:
            ${providersMigrationSummary.success} records migrated
            ${providersMigrationSummary.skipped} records skipped
            ${providersMigrationSummary.failed} records failed
    `;
  } finally {
    await knex.destroy();
  }
};

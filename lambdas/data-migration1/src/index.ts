import { getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';

import { migrateCollections } from './collections';
import { migrateProviders } from './providers';
import { migrateAsyncOperations } from './async-operations';
import { migrateRules } from './rules';

const logger = new Logger({ sender: '@cumulus/data-migration1' });
export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<string> => {
  const env = event.env ?? process.env;

  const knex = await getKnexClient({ env });

  try {
    const collectionsMigrationSummary = await migrateCollections(env, knex);
    const providersMigrationSummary = await migrateProviders(env, knex);
    const asyncOpsMigrationSummary = await migrateAsyncOperations(env, knex);
    const rulesMigrationSummary = await migrateRules(env, knex);
    const summary = `
      Migration summary:
        Collections:
          Out of ${collectionsMigrationSummary.dynamoRecords} DynamoDB records:
            ${collectionsMigrationSummary.success} records migrated
            ${collectionsMigrationSummary.skipped} records skipped
            ${collectionsMigrationSummary.failed} records failed
        Providers:
          Out of ${providersMigrationSummary.dynamoRecords} DynamoDB records:
            ${providersMigrationSummary.success} records migrated
            ${providersMigrationSummary.skipped} records skipped
            ${providersMigrationSummary.failed} records failed
        AsyncOperations:
          Out of ${asyncOpsMigrationSummary.dynamoRecords} DynamoDB records:
            ${asyncOpsMigrationSummary.success} records migrated
            ${asyncOpsMigrationSummary.skipped} records skipped
            ${asyncOpsMigrationSummary.failed} records failed
        Rules:
          Out of ${rulesMigrationSummary.dynamoRecords} DynamoDB records:
            ${rulesMigrationSummary.success} records migrated
            ${rulesMigrationSummary.skipped} records skipped
            ${rulesMigrationSummary.failed} records failed
    `;
    logger.info(summary);
    return summary;
  } finally {
    await knex.destroy();
  }
};

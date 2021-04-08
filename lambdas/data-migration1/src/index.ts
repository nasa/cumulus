import { MigrationSummary, getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';

import { migrateCollections } from './collections';
import { migrateProviders } from './providers';
import { migrateAsyncOperations } from './async-operations';
import { migrateRules } from './rules';

const logger = new Logger({ sender: '@cumulus/data-migration2' });
export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<MigrationSummary> => {
  const env = event.env ?? process.env;
  const knex = await getKnexClient({ env });

  try {
    const collectionsMigrationSummary = await migrateCollections(env, knex);
    const providersMigrationSummary = await migrateProviders(env, knex);
    const asyncOpsMigrationSummary = await migrateAsyncOperations(env, knex);
    const rulesMigrationSummary = await migrateRules(env, knex);

    const result: MigrationSummary = {
      MigrationSummary: {
        collections: {
          total_dynamo_db_records: collectionsMigrationSummary.dynamoRecords,
          migrated: collectionsMigrationSummary.success,
          skipped: collectionsMigrationSummary.skipped,
          failed: collectionsMigrationSummary.failed,
        },
        providers: {
          total_dynamo_db_records: providersMigrationSummary.dynamoRecords,
          migrated: providersMigrationSummary.success,
          skipped: providersMigrationSummary.skipped,
          failed: providersMigrationSummary.failed,
        },
        async_operations: {
          total_dynamo_db_records: asyncOpsMigrationSummary.dynamoRecords,
          migrated: asyncOpsMigrationSummary.success,
          skipped: asyncOpsMigrationSummary.skipped,
          failed: asyncOpsMigrationSummary.failed,
        },
        rules: {
          total_dynamo_db_records: rulesMigrationSummary.dynamoRecords,
          migrated: rulesMigrationSummary.success,
          skipped: rulesMigrationSummary.skipped,
          failed: rulesMigrationSummary.failed,
        },
      },
    };
    logger.info(result);
    return result;
  } finally {
    await knex.destroy();
  }
};

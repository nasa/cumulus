import path from 'path';
import { getKnexClient } from '@cumulus/db';

export type Command = 'latest' | 'rollback';

export interface HandlerEvent {
  command?: Command,
  env?: NodeJS.ProcessEnv,
  useBootstrap?: boolean // Add a flag to toggle bootstrap mode
}

export const handler = async (event: HandlerEvent): Promise<void> => {
  let knex;
  try {
    const env = event.env ?? process.env;
    knex = await getKnexClient({ env });

    const hasCollections = await knex.schema.hasTable('collections');

    // IF useBootstrap is requested AND collections table is missing, use bootstrap.
    // OTHERWISE, fall back to standard migrations.
    const selectedDir = (event.useBootstrap && !hasCollections)
      ? path.join(__dirname, 'migrations-bootstrap')
      : path.join(__dirname, 'migrations');

    const migrationConfig = {
      directory: selectedDir,
    };

    const command = event.command ?? 'latest';

    switch (command) {
      case 'latest':
        await knex.migrate.latest(migrationConfig);
        break;
      case 'rollback':
        await knex.migrate.rollback(migrationConfig);
        break;
      default:
        throw new Error(`Invalid command: ${command}`);
    }
  } finally {
    if (knex) {
      await knex.destroy();
    }
  }
};

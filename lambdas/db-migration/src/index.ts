import path from 'path';
import { getKnexClient } from '@cumulus/db';

export type Command = 'latest' | 'rollback';

export interface HandlerEvent {
  command?: Command,
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<void> => {
  let knex;
  try {
    const env = event.env ?? process.env;
    knex = await getKnexClient({ env });

    const command = event.command ?? 'latest';
    const useBootstrapRequested = process.env.USE_BOOTSTRAP?.toLowerCase() === 'true';

    const bootstrapDir = path.join(__dirname, 'migrations-bootstrap');
    const standardDir = path.join(__dirname, 'migrations');

    switch (command) {
      case 'latest': {
        // LATEST: Only use bootstrap if requested AND the database is empty
        const hasCollections = await knex.schema.hasTable('collections');
        const selectedDir = (useBootstrapRequested && !hasCollections)
          ? bootstrapDir
          : standardDir;

        await knex.migrate.latest({ directory: selectedDir });
        break;
      }
      case 'rollback': {
        // ROLLBACK: Strictly follow the environment variable toggle
        const selectedDir = useBootstrapRequested
          ? bootstrapDir
          : standardDir;

        await knex.migrate.rollback({ directory: selectedDir });
        break;
      }
      default:
        throw new Error(`Invalid command: ${command}`);
    }
  } finally {
    if (knex) {
      await knex.destroy();
    }
  }
};

import path from 'path';
import { getKnexClient } from '@cumulus/db';
import { inTestMode } from '@cumulus/common/test-utils';

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
    const useBootstrapRequested = env.USE_BOOTSTRAP?.toLowerCase() === 'true';

    const cumulusDbDir = inTestMode()
      ? path.join(path.dirname(require.resolve('@cumulus/db/package.json')), 'dist')
      : __dirname;
    const bootstrapDir = path.join(cumulusDbDir, 'migrations-bootstrap');
    const standardDir = path.join(cumulusDbDir, 'migrations');

    switch (command) {
      case 'latest': {
        // Only use bootstrap if requested AND the database is empty
        const hasCollections = await knex.schema.hasTable('collections');
        const selectedDir = (useBootstrapRequested && !hasCollections)
          ? bootstrapDir
          : standardDir;

        await knex.migrate.latest({
          directory: selectedDir,
          loadExtensions: ['.js'],
        });
        break;
      }
      case 'rollback': {
        // Use standard migration directory which has all patches
        await knex.migrate.rollback({
          directory: standardDir,
          loadExtensions: ['.js'],
        });
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

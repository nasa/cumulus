import { getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';

import { migrateReconciliationReports } from './reconciliation-reports';
import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/reconciliation-report-migration' });

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<MigrationSummary> => {
  const env = event.env ?? process.env;
  const knex = await getKnexClient({ env });

  try {
    const migrationSummary = await migrateReconciliationReports(env, knex);
    logger.info(JSON.stringify(migrationSummary));
    return { reconciliation_reports: migrationSummary };
  } finally {
    await knex.destroy();
  }
};

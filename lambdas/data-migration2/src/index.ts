import { getKnexClient } from '@cumulus/db';
import Logger from '@cumulus/logger';
import {
  DataMigration2Summary,
  DataMigration2HandlerEvent,
  MigrationSummary,
} from '@cumulus/types/migration';

import { migrateExecutions } from './executions';
import { migrateGranulesAndFiles } from './granulesAndFiles';
import { migratePdrs } from './pdrs';

const logger = new Logger({ sender: '@cumulus/data-migration2' });

export const handler = async (
  event: DataMigration2HandlerEvent
): Promise<MigrationSummary> => {
  const env = event.env ?? process.env;
  const migrationsToRun = event.migrationsList ?? ['executions', 'granules', 'pdrs'];

  const knex = await getKnexClient({ env });

  try {
    const migrationSummary: DataMigration2Summary = {};

    if (migrationsToRun.includes('executions')) {
      const executionsMigrationResult = await migrateExecutions(
        env,
        knex,
        event.executionMigrationParams
      );
      migrationSummary.executions = executionsMigrationResult;
    }

    if (migrationsToRun.includes('pdrs')) {
      const pdrsMigrationResult = await migratePdrs(
        env,
        knex,
        event.pdrMigrationParams
      );
      migrationSummary.pdrs = pdrsMigrationResult;
    }

    if (migrationsToRun.includes('granules')) {
      const { granulesResult, filesResult } = await migrateGranulesAndFiles(
        env,
        knex,
        event.granuleMigrationParams
      );
      migrationSummary.granules = granulesResult;
      migrationSummary.files = filesResult;
    }

    const summary: MigrationSummary = {
      MigrationSummary: migrationSummary,
    };
    logger.info(summary);
    return summary;
  } finally {
    await knex.destroy();
  }
};

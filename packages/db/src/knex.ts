import Knex, { PgConnectionConfig } from 'knex';
import { inTestMode } from '@cumulus/common/test-utils';

export const createClient = ({
  connectionConfig,
}: {
  connectionConfig: PgConnectionConfig
}): Knex<any, unknown[]> =>
  Knex({
    client: 'pg',
    connection: connectionConfig,
    asyncStackTraces: inTestMode(),
  });

const localStackConnectionConfig = (): PgConnectionConfig => ({
  host: 'localhost',
  user: 'postgres',
  password: 'password',
  database: 'postgres',
});

export const createLocalStackClient = (): Knex<any, unknown[]> =>
  createClient({ connectionConfig: localStackConnectionConfig() });

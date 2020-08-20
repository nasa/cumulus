import Knex, { PgConnectionConfig } from 'knex';

export const createClient = ({
  connectionConfig,
}: {
  connectionConfig: PgConnectionConfig
}): Knex<any, unknown[]> =>
  Knex({
    client: 'pg',
    connection: connectionConfig,
    asyncStackTraces: process.env.NODE_ENV === 'test',
  });

const localStackConnectionConfig = (): PgConnectionConfig => ({
  host: 'localhost',
  user: 'postgres',
  password: 'password',
  database: 'postgres',
});

export const createLocalStackClient = (): Knex<any, unknown[]> =>
  createClient({ connectionConfig: localStackConnectionConfig() });

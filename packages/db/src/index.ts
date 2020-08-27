import Knex from 'knex';
import { getSecretConnectionConfig, getEnvConnectionConfig } from './config';

export interface knexConnectionConfigObject {
  host: string,
  username: string,
  password: string,
  database?: string,
}

export interface knexConfigObject {
  client: string,
  connection: knexConnectionConfigObject,
  acquireConnectionTimeout: number,
  asyncStackTraces: boolean,
  debug: boolean,
  migrations?: {
    directory: string
  }
}

export const dropAllTables = async ({
  knex,
  schema = 'public',
}: {
  knex: Knex<any, unknown[]>,
  schema?: string
}): Promise<void> => {
  const result = await knex
    .select('table_name')
    .from('information_schema.tables')
    .where({ table_schema: schema });

  const tableNames = result.map((x) => x.table_name);

  await Promise.all(
    tableNames.map((tableName) => knex.schema.dropTable(tableName))
  );
};

export const getConnectionFromEnvironment = async (
  env: NodeJS.ProcessEnv
): Promise<Knex> => {
  let connectionConfig = {};
  if (env?.databaseCredentialSecretId === undefined) {
    connectionConfig = await getEnvConnectionConfig(env);
  } else {
    connectionConfig = await getSecretConnectionConfig(env.databaseCredentialSecretId);
  }

  let knexConfig = {
    client: 'pg',
    connection: connectionConfig,
    debug: env?.KNEX_DEBUG === 'true',
    asyncStackTraces: env?.KNEX_ASYNC_STACK_TRACES === 'true',
    acquireConnectionTimeout: 60000,
  } as knexConfigObject;

  if (env?.migrationDir) {
    knexConfig = {
      ...knexConfig,
      migrations: {
        directory: env.migrationDir,
      },
    };
  }
  return Knex(knexConfig);
};

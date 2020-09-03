import Knex from 'knex';

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

export { getKnexClient } from './client';
export { getKnexConfig, localStackConnectionEnv } from './config';

import Knex from 'knex';
import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

const getRequiredEnvVar = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env?.[name];

  if (value) return value;

  throw new Error(`The ${name} environment variable must be set`);
};

export const migrateCollections = async (env: NodeJS.ProcessEnv) => {
  const collectionsTable = getRequiredEnvVar('CollectionsTable', env);
  const dbSearchQueue = new DynamoDbSearchQueue({
    TableName: collectionsTable,
  }, 'scan');
  let result = await dbSearchQueue.peek();
  while (result) {
    console.log(result);
    await dbSearchQueue.shift();
    result = await dbSearchQueue.peek();
  }
  // return knex('collections').insert(data);
};

const getConnectionConfig = (env: NodeJS.ProcessEnv): Knex.PgConnectionConfig => ({
  host: getRequiredEnvVar('PG_HOST', env),
  user: getRequiredEnvVar('PG_USER', env),
  // TODO Get this value from secrets manager
  password: getRequiredEnvVar('PG_PASSWORD', env),
  database: getRequiredEnvVar('PG_DATABASE', env),
});

export const handler = async (event: HandlerEvent): Promise<void> => {
  const env = event?.env ?? process.env;

  const knex = Knex({
    client: 'pg',
    connection: getConnectionConfig(env),
    debug: env?.KNEX_DEBUG === 'true',
    asyncStackTraces: env?.KNEX_ASYNC_STACK_TRACES === 'true',
  });

  try {
    await migrateCollections(env);
  } finally {
    await knex.destroy();
  }
};

import AWS from 'aws-sdk';

import Knex from 'knex';
import * as path from 'path';

export type Command = 'latest';

export interface HandlerEvent {
  command?: Command,
  env?: NodeJS.ProcessEnv
}

const getRequiredEnvVar = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env?.[name];

  if (value) return value;

  throw new Error(`The ${name} environment variable must be set`);
};

const getSecretConnectionConfig = async (SecretId: string): Promise<Knex.PgConnectionConfig> => {
  const secretsManager = new AWS.SecretsManager();
  const response = await secretsManager.getSecretValue(
    { SecretId } as AWS.SecretsManager.GetSecretValueRequest
  ).promise();
  if (response.SecretString === undefined) {
    throw new Error(`AWS Secret did not contain a stored value: ${SecretId}`);
  }
  const dbAccessMeta = JSON.parse(response.SecretString);

  ['host', 'username', 'password', 'database'].forEach((key) => {
    if (!(key in dbAccessMeta)) {
      throw new Error(`AWS Secret ${SecretId} is missing required key '${key}'`);
    }
  });
  return {
    host: dbAccessMeta.host,
    user: dbAccessMeta.username,
    password: dbAccessMeta.password,
    database: dbAccessMeta.database,
  };
};

const getConnectionConfig = async (env: NodeJS.ProcessEnv): Promise<Knex.PgConnectionConfig> => {
  if (env?.databaseCredentialSecretId === undefined) {
    return {
      host: getRequiredEnvVar('PG_HOST', env),
      user: getRequiredEnvVar('PG_USER', env),
      password: getRequiredEnvVar('PG_PASSWORD', env),
      database: getRequiredEnvVar('PG_DATABASE', env),
    };
  }
  return getSecretConnectionConfig(env?.databaseCredentialSecretId);
};

export const handler = async (event: HandlerEvent): Promise<void> => {
  let knex;
  try {
    const env = event?.env ?? process.env;
    const connectionConfig = await getConnectionConfig(env);

    knex = Knex({
      client: 'pg',
      connection: connectionConfig,
      debug: env?.KNEX_DEBUG === 'true',
      asyncStackTraces: env?.KNEX_ASYNC_STACK_TRACES === 'true',
      migrations: {
        directory: path.join(__dirname, 'migrations'),
      },
      acquireConnectionTimeout: 120000,
    });

    const command = event?.command ?? 'latest';

    switch (command) {
      case 'latest':
        await knex.migrate.latest();
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

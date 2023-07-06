import AWS from 'aws-sdk';
import { Knex } from 'knex';

import { envUtils } from '@cumulus/common';

export const localStackConnectionEnv = {
  PG_HOST: 'localhost',
  PG_USER: 'postgres',
  PG_PASSWORD: 'password',
  PG_DATABASE: 'postgres',
  PG_PORT: '5432',
};

export const isKnexDebugEnabled = (
  env: NodeJS.ProcessEnv = {}
) => env.KNEX_DEBUG === 'true';

export const getSecretConnectionConfig = async (
  SecretId: string,
  secretsManager: AWS.SecretsManager
): Promise<Knex.PgConnectionConfig> => {
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
    port: dbAccessMeta.port ?? 5432,
    ssl: true,
  };
};

export const getConnectionConfigEnv = (
  env: NodeJS.ProcessEnv
): Knex.PgConnectionConfig => ({
  host: envUtils.getRequiredEnvVar('PG_HOST', env),
  user: envUtils.getRequiredEnvVar('PG_USER', env),
  password: envUtils.getRequiredEnvVar('PG_PASSWORD', env),
  database: envUtils.getRequiredEnvVar('PG_DATABASE', env),
  port: Number.parseInt(env.PG_PORT ?? '5432', 10),
});

/**
 * Return configuration to make a database connection.
 *
 * @param {Object} params
 * @param {NodeJS.ProcessEnv} params.env
 *   Environment values for the operation
 * @param {AWS.SecretsManager} params.secretsManager
 *   An instance of an AWS Secrets Manager client
 * @returns {Knex.PgConnectionConfig}
 *   Configuration to make a Postgres database connection.
 */
export const getConnectionConfig = async ({
  env,
  secretsManager = new AWS.SecretsManager(),
}: {
  env: NodeJS.ProcessEnv,
  secretsManager?: AWS.SecretsManager
}): Promise<Knex.PgConnectionConfig> => {
  // Storing credentials in Secrets Manager
  if (env.databaseCredentialSecretArn) {
    return await getSecretConnectionConfig(
      env.databaseCredentialSecretArn,
      secretsManager
    );
  }

  // Getting credentials from environment variables
  return await getConnectionConfigEnv(env);
};

/**
 * Given a NodeJS.ProcessEnv with configuration values, build and return Knex
 * configuration
 *
 * @param {Object} params
 * @param {NodeJS.ProcessEnv} params.env - Object with configuration keys
 *
 * Requires either:
 * @param {string} params.env.PG_HOST - Hostname database cluster
 * @param {string} params.env.PG_USER - User to connect to the database
 * @param {string} params.env.PG_PASSWORD - Password to use to connect to the database
 * @param {string} [params.env.PG_DATABASE] - postgres database to connect to on the db
 *   cluster
 *
 * Or:
 * @param {string} params.env.databaseCredentialSecretArn - key referencing an
 *   AWS SecretsManager Secret with required
 * `databaseCredentialSecretArn` keys:
 *   host     - Hostname database cluster
 *   username - User to connect to the database
 *   password - Password to use to connect to the database
 *   database - Optional - postgres database to connect to on the db cluster
 *
 * Additionally, the following are configuration options:
 * @param {string} [params.env.KNEX_ASYNC_STACK_TRACES] - If set to 'true' will
 *   enable knex async stack traces.
 * @param {string} [params.env.KNEX_DEBUG] - If set to 'true' will enable knex
 *   debugging
 * @param {string} [params.env.acquireConnectionTimeout] - Knex
 *   acquireConnectionTimeout connection timeout
 * @param {string} [params.env.migrationDir] - Directory to look in for
 *   migrations
 * @param {string} [params.env.createTimeoutMillis]  - tarn/knex pool object
 *                                                     creation timeout
 * @param {string} [params.env.idleTimeoutMillis]    - tarn/knex pool object
 *                                                     idle timeout
 * @param {string} [params.env.dbMaxPool]            - tarn/knex max pool
 *                                                     connections
 * @returns {Promise<Knex.Config>} a Knex configuration object
 */
export const getKnexConfig = async ({
  env = process.env,
  secretsManager = new AWS.SecretsManager(),
}: {
  env?: NodeJS.ProcessEnv,
  secretsManager?: AWS.SecretsManager
} = {}): Promise<Knex.Config> => {
  const knexConfig: Knex.Config = {
    client: 'pg',
    connection: await getConnectionConfig({ env, secretsManager }),
    debug: isKnexDebugEnabled(env),
    asyncStackTraces: env.KNEX_ASYNC_STACK_TRACES === 'true',
    pool: {
      min: 0,
      max: Number.parseInt(env.dbMaxPool ?? '2', 10),
      idleTimeoutMillis: Number.parseInt(env.idleTimeoutMillis ?? '1000', 10),
      // ts-ignore as https://github.com/knex/knex/blob/master/types/index.d.ts#L1886
      // is improperly typed.
      //@ts-ignore
      acquireTimeoutMillis: Number.parseInt(env.acquireTimeoutMillis ?? '90000', 10),
      createRetryIntervalMillis: Number.parseInt(env.createRetryIntervalMillis ?? '30000', 10),
      createTimeoutMillis: Number.parseInt(env.createTimeoutMillis ?? '20000', 10),
      destroyTimeoutMillis: Number.parseInt(env.destroyTimeoutMillis ?? '5000', 10),
      reapIntervalMillis: Number.parseInt(env.reapIntervalMillis ?? '1000', 10),
      propagateCreateError: false,
    },
  };

  knexConfig.acquireConnectionTimeout = env.acquireTimeoutMillis
    ? Number(env.acquireTimeoutMillis + 1000)
    : 60000;

  if (env.migrationDir) {
    knexConfig.migrations = {
      directory: env.migrationDir,
      loadExtensions: ['.js'],
    };
  }

  return knexConfig;
};

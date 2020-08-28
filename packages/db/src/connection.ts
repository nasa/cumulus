import AWS from 'aws-sdk';
import Knex from 'knex';
import { getSecretConnectionConfig, getConnectionConfigEnv } from './config';

/**
 * Builds a Knex.PgConnectionConfig
 *
 * @param {NodeJS.ProcessEnv} params - parameter object with knex configuration
 * @returns {Knex.PgConnectionConfig} - KnexConfigObject
 */
const buildKnexConfiguration = ({
  connectionConfig,
  debug = false,
  asyncStackTraces = false,
  timeout = 60000,
  migrationDir,
}: {
  connectionConfig: Knex.PgConnectionConfig,
  debug?: boolean,
  asyncStackTraces?: boolean,
  timeout?: number,
  migrationDir?: string,
}): Knex.Config => {
  const knexConfig: Knex.Config = {
    client: 'pg',
    connection: connectionConfig,
    debug,
    asyncStackTraces,
    acquireConnectionTimeout: timeout,
  };

  if (migrationDir !== undefined) {
    knexConfig.migrations = { directory: migrationDir };
  }
  return knexConfig;
};

/**
* Given a NodeJS.ProcessEnv with configuration values, build and return a
* Knex instance
* @param {NodeJS.ProcessEnv} env .  - Object with configuration keys
*                                                  set
* Requires either:
* @param {string} env.PG_HOST       - Hostname database cluster
* @param {string} env.PG_USER       - User to connect to the database
* @param {string} env.PG_PASSWORD   - Password to use to connect to the database
* @param {string} [env.PG_DATABASE] - Optional - postgres database to connect to on the db cluster
* Or:
* @param {string} env.databaseCredentialSecretArn - key referencing a AWS SecretsManager
*                                                   Secret with required
* `databaseCredentialSecretArn` keys:
*   host     - Hostname database cluster
*   username - User to connect to the database
*   password - Password to use to connect to the database
*   database - Optional - postgres database to connect to on the db cluster
*
* Additionally, the following are configuration options:
* @param {string} [env.KNEX_ASYNC_STACK_TRACES]  - If set to 'true' will enable knex async
*                                                  stack traces.
* @param {string} [env.KNEX_DEBUG]               - If set to 'true' will enable knex debugging
* @param {string} [env.acquireConnectionTimeout] - Knex acquireConnectionTimeout connection timeout
* @param {string} [env.migrationDir]             - Directory to look in for migrations
*
* @returns {Promise<Knex>} Returns a configured knex instance
*/
export const knex = async (env: NodeJS.ProcessEnv): Promise<Knex> => {
  let connectionConfig: Knex.PgConnectionConfig;

  if (env.databaseCredentialSecretArn) {
    const secretsManager = new AWS.SecretsManager();
    connectionConfig = await getSecretConnectionConfig(
      env.databaseCredentialSecretArn,
      secretsManager
    );
  } else {
    connectionConfig = getConnectionConfigEnv(env);
  }

  let timeout;
  if (env.knexAcquireConnectionTimeout) {
    timeout = Number(env.knexAcquireConnectionTimeout);
  }

  const knexConfig = buildKnexConfiguration({
    connectionConfig,
    asyncStackTraces: env.KNEX_ASYNC_STACK_TRACES === 'true',
    debug: env.KNEX_DEBUG === 'true',
    migrationDir: env.migrationDir,
    timeout,
  });

  return Knex(knexConfig);
};

import Knex from 'knex';
import { getSecretConnectionConfig, getConnectionConfigEnv } from './config';

import { envConectionConfigObject, knexSecretConnectionConfigObject } from './types';

export interface knexConnectionConfigObject {
  host: string,
  username: string,
  password: string,
  database?: string,
}

/**
* Builds a Knex.PgConnectionConfig
*
* @param {NodeJS.ProcessEnv} params - parameter object with knex configuration
* @returns {Knex.PgConnectionConfig} - KnexConfigObject
*/
const buildKnexConfiguration = (
  params: {
    connectionConfig: Knex.PgConnectionConfig,
    KNEX_DEBUG?: string,
    KNEX_ASYNC_STACK_TRACES?: string,
    timeout: number,
    migrationDir?: string,
  }
): Knex.Config => {
  const knexConfig: Knex.Config = {
    client: 'pg',
    connection: params.connectionConfig,
    debug: params.KNEX_DEBUG === 'true',
    asyncStackTraces: params.KNEX_ASYNC_STACK_TRACES === 'true',
    acquireConnectionTimeout: params.timeout,
  };

  if (params.migrationDir !== undefined) {
    knexConfig.migrations = { directory: params.migrationDir };
  }
  return knexConfig;
};

/**
* Returns a configured Knex object configured for connection to a postgres database
* @param {getConnectionFromSecretEnv} env         - Environment vars object with
* @param {string} env.databaseCredentialSecretArn - key referencing a AWS SecretsManager
*                                                   Secret with required
* `databaseCredentialSecretArn` keys:
*   host     - Hostname database cluster
*   username - User to connect to the database
*   password - Password to use to connect to the database
*   database - Optional - postgres database to connect to on the db cluster
* @param {string} [env.KNEX_ASYNC_STACK_TRACES]  - If set to 'true' will enable knex async
*                                                  stack traces.
* @param {string} [env.KNEX_DEBUG]               - If set to 'true' will enable knex debugging
* @param {string} [env.acquireConnectionTimeout] - Knex acquireConnectionTimeout connection timeout
* @param {string} [env.migrationDir]             - Directory to look in for migrations
*
* @returns {Promise<Knex>} Brief description of the returning value here.
*/
export const getKnexFromSecret = async (
  env: knexSecretConnectionConfigObject
): Promise<Knex> => {
  const connectionConfig = await getSecretConnectionConfig(env.databaseCredentialSecretArn);
  const knexConfig = buildKnexConfiguration({
    connectionConfig,
    KNEX_ASYNC_STACK_TRACES: env.KNEX_ASYNC_STACK_TRACES,
    KNEX_DEBUG: env.KNEX_DEBUG,
    migrationDir: env.migrationDir,
    timeout: env?.knexAcquireConnectionTimeout ? Number(env.knexAcquireConnectionTimeout) : 60000,
  });
  return Knex(knexConfig);
};

/**
* Returns a configured Knex object configured for connection to a postgres database
* @summary If the description is long, write your summary here. Otherwise, feel free to remove this.
* @param {getConnectionConfigEnvEnvironment} env - Object with database configuration environment
*                                                  set
* @param {string} env.PG_HOST       - Hostname database cluster
* @param {string} env.PG_USER       - User to connect to the database
* @param {string} env.PG_PASSWORD   - Password to use to connect to the database
* @param {string} [env.PG_DATABASE] - Optional - postgres database to connect to on the db cluster
* @param {string} [env.KNEX_ASYNC_STACK_TRACES]  - If set to 'true' will enable knex async
*                                                  stack traces.
* @param {string} [env.KNEX_DEBUG]               - If set to 'true' will enable knex debugging
* @param {string} [env.acquireConnectionTimeout] - Knex acquireConnectionTimeout connection timeout
* @param {string} [env.migrationDir]             - Directory to look in for migrations
*
* @returns {Promise<Knex>} Brief description of the returning value here.
*/
export const getKnexFromEnvironment = async (
  env: envConectionConfigObject
): Promise<Knex> => {
  const connectionConfig = await getConnectionConfigEnv(env);
  const knexConfig = buildKnexConfiguration({
    connectionConfig,
    KNEX_ASYNC_STACK_TRACES: env.KNEX_ASYNC_STACK_TRACES,
    KNEX_DEBUG: env.KNEX_DEBUG,
    migrationDir: env.migrationDir,
    timeout: env?.timeout ? Number(env.timeout) : 10000,
  });
  return Knex(knexConfig);
};

function isKnexSecretConnectionConfigObject(
  env: envConectionConfigObject | knexSecretConnectionConfigObject | NodeJS.ProcessEnv
): env is knexSecretConnectionConfigObject {
  return (env as knexSecretConnectionConfigObject).databaseCredentialSecretArn !== undefined;
}

function isenvConectionConfigObject(
  env: envConectionConfigObject | knexSecretConnectionConfigObject | NodeJS.ProcessEnv
): env is envConectionConfigObject {
  return ((env as envConectionConfigObject).PG_HOST !== undefined
    && (env as envConectionConfigObject).PG_PASSWORD !== undefined
    && (env as envConectionConfigObject).PG_USERNAME !== undefined);
}

/**
* Given a NodeJS.ProcessEnv with configuration values, typecast and call the
* approprite getKnex method
* @param {NodeJS.ProcessEnv} env - Object with configuration keys
* @returns {Promise<Knex>} - Return configured Knex instance
*/
export const knex = async (
  env: envConectionConfigObject | knexSecretConnectionConfigObject | NodeJS.ProcessEnv
): Promise<Knex> => {
  if (isKnexSecretConnectionConfigObject(env)) {
    return getKnexFromSecret(env);
  }
  if (isenvConectionConfigObject(env)) {
    return getKnexFromEnvironment(env);
  }
  throw new Error('Passed in environment variable must contain either databaseCredentialSecretArn or postgres config');
};

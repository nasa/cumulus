import AWS from 'aws-sdk';
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
    && (env as envConectionConfigObject).PG_USER !== undefined);
}

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
export const knex = async (
  env: envConectionConfigObject | knexSecretConnectionConfigObject | NodeJS.ProcessEnv
): Promise<Knex> => {
  let connectionConfig;
  if (isKnexSecretConnectionConfigObject(env)) {
    const secretsManager = new AWS.SecretsManager();
    connectionConfig = await getSecretConnectionConfig(
      env.databaseCredentialSecretArn,
      secretsManager
    );
  } else if (isenvConectionConfigObject(env)) {
    connectionConfig = await getConnectionConfigEnv(env);
  } else {
    throw new Error('"env" must contain either databaseCredentialSecretArn or postgres config');
  }
  const knexConfig = buildKnexConfiguration({
    connectionConfig,
    KNEX_ASYNC_STACK_TRACES: env.KNEX_ASYNC_STACK_TRACES,
    KNEX_DEBUG: env.KNEX_DEBUG,
    migrationDir: env.migrationDir,
    timeout: env?.knexAcquireConnectionTimeout === undefined
      ? Number(env.knexAcquireConnectionTimeout) : 60000,
  });
  return Knex(knexConfig);
};

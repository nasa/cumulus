import Knex from 'knex';
import { getSecretConnectionConfig, getConnectionConfigEnv } from './config';

import { envConectionConfigObject, knexSecretConnectionConfigObject } from './types';

export interface knexConnectionConfigObject {
  host: string,
  username: string,
  password: string,
  database?: string,
}

interface knexEnvironmentObject extends NodeJS.ProcessEnv {
  KNEX_DEBUG?: string
  KNEX_ASYNC_STACK_TRACES?: string,
}

/**
* @summary Given a knexEnvironmentObject and a Knex.PgConnectionConfig, returns
* a Knex instance with those confiugrations applied
*
* @param {Knex.PgConnectionConfig} connectionConfig - Knex connection configuration
* @param {knexEnvironmentObject} env - environment object with knex configuration keys
* @returns {Knex} - configured Knex instance
*/
const getConfiguredKnex = (
  connectionConfig: Knex.PgConnectionConfig,
  env: knexEnvironmentObject
): Knex => {
  let knexConfig = {
    client: 'pg',
    connection: connectionConfig,
    debug: env.KNEX_DEBUG === 'true',
    asyncStackTraces: env?.KNEX_ASYNC_STACK_TRACES === 'true',
    acquireConnectionTimeout: env.timeout ? env.timeout : 60000,
  } as Knex.Config;

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

/**
* Returns a configured Knex object configured for connection to a postgres database
* @param {getConnectionFromSecretEnv} env - Environment vars object with
* databaseCredentialSecretArn key referencing a AWS SecretsManager Secret with required
* `databaseCredentialSecretArn` keys:
*   host     - Hostname database cluster
*   username - User to connect to the database
*   password - Password to use to connect to the database
*   database - Optional - postgres database to connect to on the db cluster
* @returns {Promie<Knex>} Brief description of the returning value here.
*/
export const getKnexFromSecret = async (
  env: knexSecretConnectionConfigObject
): Promise<Knex> => {
  const config = await getSecretConnectionConfig(env.databaseCredentialSecretArn);
  return getConfiguredKnex(config, env);
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

* @param {string} env.host     - Hostname database cluster

* @returns {Promie<Knex>} Brief description of the returning value here.
*/
export const getKnexFromEnvironment = async (
  env: envConectionConfigObject
): Promise<Knex> => {
  const config = await getConnectionConfigEnv(env);
  return getConfiguredKnex(config, env);
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

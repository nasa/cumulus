import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { services } from '@cumulus/aws-client';
import { knex, Knex } from 'knex';
import Logger from '@cumulus/logger';

import { getKnexConfig, isKnexDebugEnabled } from './config';

const log = new Logger({ sender: '@cumulus/db/connection' });

/**
 * Given a NodeJS.ProcessEnv with configuration values, build and return
 * Knex client
 *
 * @param {Object} params
 * @param {NodeJS.ProcessEnv} params.env    - Object with configuration keys
 *
 * Requires either:
 * @param {string} params.env.PG_HOST       - Hostname database cluster
 * @param {string} params.env.PG_USER       - User to connect to the database
 * @param {string} params.env.PG_PASSWORD   - Password to use to connect to the database
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
 * @param {SecretsManager} [params.secretsManager] - An instance of an AWS secrets manager client
 * @param {Logger} [params.knexLogger] - a logger instance
 * @returns {Promise<Knex>} a Knex configuration object that has returned at least one query
 */
export const getKnexClient = async ({
  env = process.env,
  secretsManager = services.secretsManager(),
  knexLogger = log,
}: {
  env?: NodeJS.ProcessEnv,
  secretsManager?: SecretsManager,
  knexLogger?: Logger
} = {}): Promise<Knex> => {
  if (isKnexDebugEnabled(env)) {
    knexLogger.info('Initializing connection pool...');
  }
  const knexConfig = await getKnexConfig({ env, secretsManager });
  const knexClient = knex(knexConfig);
  if (isKnexDebugEnabled(env)) {
    //@ts-ignore
    // context is an internal object that isn't typed
    // this is needed to force tarn to log per-retry failures
    // and allow propagateCreateError to be set `false`
    knexClient.context.client.pool.on('createFail', (_, error) => {
      knexLogger.warn('knex failed on attempted connection', error);
      throw error;
    });
    //@ts-ignore
    knexClient.context.client.pool.on('createSuccess', (_, resource) => {
      knexLogger.info(`added connection to pool: ${JSON.stringify(resource)}`);
    });
    //@ts-ignore
    knexClient.context.client.pool.on('acquireSuccess', (_, resource) => {
      knexLogger.info(`acquired connection from pool: ${JSON.stringify(resource)}`);
    });
    //@ts-ignore
    knexClient.context.client.pool.on('release', (resource) => {
      knexLogger.info(`released connection from pool: ${JSON.stringify(resource)}`);
    });
    //@ts-ignore
    knexClient.context.client.pool.on('poolDestroySuccess', () => {
      knexLogger.info('pool is destroyed');
    });
  }
  return knexClient;
};

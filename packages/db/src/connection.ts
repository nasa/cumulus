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

// Singleton Knex client for long-running server processes (ECS)
let knexClientSingleton: Knex | undefined;
let knexClientSingletonPromise: Promise<Knex> | undefined;

/**
 * Initialize a singleton Knex client for ECS server mode.
 * This ensures a single connection pool is reused across all requests.
 * Concurrent calls are safe - they will wait for the same initialization.
 *
 * @param {Object} params - Configuration parameters
 * @param {NodeJS.ProcessEnv} params.env - Environment variables
 * @param {SecretsManager} [params.secretsManager] - AWS Secrets Manager client
 * @param {Logger} [params.knexLogger] - Logger instance
 * @returns {Promise<Knex>} The initialized singleton Knex client
 */
export const initializeKnexClientSingleton = async ({
  env = process.env,
  secretsManager = services.secretsManager(),
  knexLogger = log,
}: {
  env?: NodeJS.ProcessEnv,
  secretsManager?: SecretsManager,
  knexLogger?: Logger
} = {}): Promise<Knex> => {
  // If already initialized, return singleton
  if (knexClientSingleton) {
    return knexClientSingleton;
  }

  // If initialization is in progress, wait for it
  if (knexClientSingletonPromise) {
    return knexClientSingletonPromise;
  }

  // Start new initialization
  knexClientSingletonPromise = (async () => {
    // Set default pool size for Iceberg API if not already configured
    const modifiedEnv = { ...env };
    if (modifiedEnv.DEPLOY_ICEBERG_API === 'true' && !modifiedEnv.dbMaxPool) {
      modifiedEnv.dbMaxPool = '50';
    }

    knexLogger.info('Initializing singleton connection pool...');
    const client = await getKnexClient({ env: modifiedEnv, secretsManager, knexLogger });
    knexClientSingleton = client;
    return client;
  })();

  try {
    return await knexClientSingletonPromise;
  } catch (error) {
    // Clear the promise on failure so retry is possible
    knexClientSingletonPromise = undefined;
    throw error;
  }
};

/**
 * Get the Knex client, using singleton pattern for Iceberg API mode.
 * In Lambda mode (DEPLOY_ICEBERG_API !== 'true'), creates a new client each time.
 * In Iceberg API mode (DEPLOY_ICEBERG_API === 'true'), returns the singleton instance.
 * Concurrent calls are safe - they will wait for the same initialization.
 *
 * @param {Object} params - Configuration parameters
 * @param {NodeJS.ProcessEnv} params.env - Environment variables
 * @param {SecretsManager} [params.secretsManager] - AWS Secrets Manager client
 * @param {Logger} [params.knexLogger] - Logger instance
 * @returns {Promise<Knex>} A Knex client instance
 */
export const getKnexClientSingleton = async ({
  env = process.env,
  secretsManager = services.secretsManager(),
  knexLogger = log,
}: {
  env?: NodeJS.ProcessEnv,
  secretsManager?: SecretsManager,
  knexLogger?: Logger
} = {}): Promise<Knex> => {
  // In Iceberg API mode, use singleton pattern
  if (env.DEPLOY_ICEBERG_API === 'true') {
    return initializeKnexClientSingleton({ env, secretsManager, knexLogger });
  }

  // In Lambda mode, create new client (Lambda will clean up)
  return getKnexClient({ env, secretsManager, knexLogger });
};

/**
 * Destroy the singleton Knex client connection pool.
 * This should be called during graceful shutdown of the ECS server.
 *
 * @returns {Promise<void>}
 */
export const destroyKnexClientSingleton = async (): Promise<void> => {
  if (knexClientSingleton) {
    log.info('Destroying singleton connection pool...');
    await knexClientSingleton.destroy();
    knexClientSingleton = undefined;
    knexClientSingletonPromise = undefined;
  }
};

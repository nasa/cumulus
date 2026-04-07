import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { services } from '@cumulus/aws-client';
import { Knex } from 'knex';
import Logger from '@cumulus/logger';

import { getKnexClient } from './connection';

const log = new Logger({ sender: '@cumulus/db/iceberg-connection' });

// Singleton Knex client for Iceberg API (separate from Cumulus API)
let icebergKnexClientSingleton: Knex | undefined;
let icebergKnexClientSingletonPromise: Promise<Knex> | undefined;

/**
 * Initialize a singleton Knex client specifically for Iceberg API.
 * This is completely separate from the Cumulus API database connections.
 *
 * @param {Object} params - Configuration parameters
 * @param {NodeJS.ProcessEnv} params.env - Environment variables
 * @param {SecretsManager} [params.secretsManager] - AWS Secrets Manager client
 * @param {Logger} [params.knexLogger] - Logger instance
 * @returns {Promise<Knex>} The initialized Iceberg API singleton Knex client
 */
export const initializeIcebergKnexClientSingleton = async ({
  env = process.env,
  secretsManager = services.secretsManager(),
  knexLogger = log,
}: {
  env?: NodeJS.ProcessEnv,
  secretsManager?: SecretsManager,
  knexLogger?: Logger
} = {}): Promise<Knex> => {
  // If already initialized, return singleton
  if (icebergKnexClientSingleton) {
    return icebergKnexClientSingleton;
  }

  // If initialization is in progress, wait for it
  if (icebergKnexClientSingletonPromise) {
    return icebergKnexClientSingletonPromise;
  }

  // Start new initialization
  icebergKnexClientSingletonPromise = (async () => {
    // Set default pool size for Iceberg API if not already configured
    const modifiedEnv = { ...env };
    if (!modifiedEnv.dbMaxPool) {
      modifiedEnv.dbMaxPool = '50';
    }

    knexLogger.info('Initializing Iceberg API singleton connection pool...');
    const client = await getKnexClient({ env: modifiedEnv, secretsManager, knexLogger });
    icebergKnexClientSingleton = client;
    return client;
  })();

  try {
    return await icebergKnexClientSingletonPromise;
  } catch (error) {
    // Clear the promise on failure so retry is possible
    icebergKnexClientSingletonPromise = undefined;
    throw error;
  }
};

/**
 * Get the Iceberg API Knex client using singleton pattern.
 * This is completely separate from Cumulus API database connections.
 *
 * @param {Object} params - Configuration parameters
 * @param {NodeJS.ProcessEnv} params.env - Environment variables
 * @param {SecretsManager} [params.secretsManager] - AWS Secrets Manager client
 * @param {Logger} [params.knexLogger] - Logger instance
 * @returns {Promise<Knex>} The Iceberg API Knex client instance
 */
export const getIcebergKnexClient = async ({
  env = process.env,
  secretsManager = services.secretsManager(),
  knexLogger = log,
}: {
  env?: NodeJS.ProcessEnv,
  secretsManager?: SecretsManager,
  knexLogger?: Logger
} = {}): Promise<Knex> =>
  initializeIcebergKnexClientSingleton({ env, secretsManager, knexLogger });

/**
 * Destroy the Iceberg API singleton Knex client connection pool.
 * This should be called during graceful shutdown of the Iceberg API server.
 *
 * @returns {Promise<void>}
 */
export const destroyIcebergKnexClientSingleton = async (): Promise<void> => {
  if (icebergKnexClientSingleton) {
    log.info('Destroying Iceberg API singleton connection pool...');
    await icebergKnexClientSingleton.destroy();
    icebergKnexClientSingleton = undefined;
    icebergKnexClientSingletonPromise = undefined;
  }
};

/**
 * Check if the Iceberg API singleton Knex client is initialized.
 *
 * @returns {boolean} True if the singleton is initialized, false otherwise
 */
export const isIcebergKnexClientSingletonInitialized = (): boolean =>
  icebergKnexClientSingleton !== undefined;

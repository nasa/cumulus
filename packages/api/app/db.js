'use strict';

const {
  initializeIcebergKnexClientSingleton,
  destroyIcebergKnexClientSingleton,
} = require('@cumulus/db');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@cumulus/api/db' });

/**
 * Initialize the Iceberg API singleton Knex client for ECS server mode.
 * Should be called once at Iceberg API server startup.
 *
 * @returns {Promise<void>}
 */
const initializeKnexClient = async () => {
  // Set default pool size for Iceberg API ECS mode if not already configured
  if (!process.env.dbMaxPool) {
    process.env.dbMaxPool = '50';
    log.info('Setting default dbMaxPool to 50 for Iceberg API ECS server mode');
  }

  log.info(`Initializing Iceberg API singleton Knex client for ECS server mode with pool size: ${process.env.dbMaxPool}`);
  await initializeIcebergKnexClientSingleton();
  log.info('Iceberg API Knex client initialized successfully');
};

/**
 * Destroy the Iceberg API singleton Knex client connection pool.
 * This should be called during graceful shutdown of the Iceberg API ECS server.
 *
 * @returns {Promise<void>}
 */
const destroyKnexClient = async () => {
  log.info('Shutting down Iceberg API Knex client...');
  await destroyIcebergKnexClientSingleton();
  log.info('Iceberg API Knex client destroyed successfully');
};

module.exports = {
  initializeKnexClient,
  destroyKnexClient,
};

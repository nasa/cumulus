'use strict';

const {
  initializeDuckDb,
  destroyDuckDb,
} = require('@cumulus/db/duckdb');

const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@cumulus/api/iceberg-db' });

/**
 * Initialize the Iceberg API DuckDB client for ECS server mode.
 * Should be called once at Iceberg API server startup.
 *
 * @returns {Promise<void>}
 */
const initializeDuckDbClient = async () => {
  log.info(`Initializing Iceberg API DuckDB client for ECS server mode with pool size: ${process.env.DUCKDB_MAX_POOL}`);
  await initializeDuckDb();
  log.info('Iceberg API DuckDB client initialized successfully');
};

/**
 * Destroy the Iceberg API DuckDB client connection pool.
 * This should be called during graceful shutdown of the Iceberg API ECS server.
 *
 * @returns {Promise<void>}
 */
const destroyDuckDbClient = async () => {
  log.info('Shutting down Iceberg API DuckDB client...');
  await destroyDuckDb();
  log.info('Iceberg API DuckDB client destroyed successfully');
};

module.exports = {
  initializeDuckDbClient,
  destroyDuckDbClient,
};

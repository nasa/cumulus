'use strict';

const {
  getKnexClient,
  getIcebergKnexClient,
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

/**
 * Express middleware to attach the Iceberg API Knex client to the request object.
 * For test contexts, respects the injected knex client.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express next middleware function
 */
const attachKnexClient = async (req, res, next) => {
  // Allow test context to override
  if (!req.testContext?.knex) {
    try {
      const knex = await getIcebergKnexClient();
      req.knexClient = knex;
    } catch (error) {
      log.error('Failed to attach Iceberg API Knex client to request', error);
      return res.boom.badImplementation('Iceberg API database connection error');
    }
  }
  return next();
};

module.exports = {
  initializeKnexClient,
  getKnexClient,
  getIcebergKnexClient,
  attachKnexClient,
  destroyKnexClient,
};

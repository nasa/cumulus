'use strict';

const {
  getKnexClientSingleton,
  initializeKnexClientSingleton,
  destroyKnexClientSingleton,
} = require('@cumulus/db');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@cumulus/api/db' });

/**
 * Initialize the singleton Knex client for ECS server mode.
 * Should be called once at server startup.
 *
 * @returns {Promise<void>}
 */
const initializeKnexClient = async () => {
  // Set default pool size for ECS mode if not already configured
  if (!process.env.dbMaxPool) {
    process.env.dbMaxPool = '50';
    log.info('Setting default dbMaxPool to 50 for ECS server mode');
  }
  
  log.info(`Initializing singleton Knex client for ECS server mode with pool size: ${process.env.dbMaxPool}`);
  await initializeKnexClientSingleton();
  log.info('Knex client initialized successfully');
};

/**
 * Destroy the singleton Knex client connection pool.
 * This should be called during graceful shutdown of the ECS server.
 *
 * @returns {Promise<void>}
 */
const destroyKnexClient = async () => {
  log.info('Shutting down Knex client...');
  await destroyKnexClientSingleton();
  log.info('Knex client destroyed successfully');
};

/**
 * Express middleware to attach the Knex client to the request object.
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
      const knex = await getKnexClientSingleton();
      req.knexClient = knex;
    } catch (error) {
      log.error('Failed to attach Knex client to request', error);
      return res.boom.badImplementation('Database connection error');
    }
  }
  next();
};

module.exports = {
  initializeKnexClient,
  getKnexClientSingleton,
  attachKnexClient,
  destroyKnexClient,
};

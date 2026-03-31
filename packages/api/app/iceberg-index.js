'use strict';

/**
 * Iceberg API Entry Point
 *
 * This is a standalone Express server that serves a limited subset of the Cumulus API.
 * It's designed to run in ECS and only exposes read-only list endpoints:
 * - GET /version
 * - GET /granules (list)
 * - GET /executions (list)
 * - GET /stats
 * - GET /stats/aggregate/:type?
 */

const cors = require('cors');
const hsts = require('hsts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const express = require('express');
const morgan = require('morgan');

const { getRequiredEnvVar } = require('@cumulus/common/env');
const { inTestMode } = require('@cumulus/common/test-utils');
const { secretsManager } = require('@cumulus/aws-client/services');
const Logger = require('@cumulus/logger');

const icebergRouter = require('./iceberg-routes');
const { jsonBodyParser } = require('./middleware');
const boom = require('../lib/expressBoom');
const { initializeKnexClient, destroyKnexClient } = require('./db');

const log = new Logger({ sender: '@api/iceberg-index' });

log.info('Initializing Iceberg API (limited endpoints for ECS deployment)');

// Load Environment Variables
const initEnvVarsFunction = async () => {
  if (inTestMode() && process.env.INIT_ENV_VARS_FUNCTION_TEST !== 'true') {
    return undefined;
  }
  log.info('Initializing environment variables');
  const apiConfigSecretId = getRequiredEnvVar('api_config_secret_id');
  try {
    const response = await secretsManager().getSecretValue(
      { SecretId: apiConfigSecretId }
    );
    let envSecret;
    try {
      envSecret = JSON.parse(response.SecretString);
    } catch (error) {
      throw new SyntaxError(`Secret string returned for SecretId ${apiConfigSecretId} could not be parsed`, { cause: error });
    }
    process.env = { ...envSecret, ...process.env };
  } catch (error) {
    log.error(`Encountered error trying to set environment variables from secret ${apiConfigSecretId}`, error);
    throw error;
  }
  return undefined;
};
const initEnvVars = initEnvVarsFunction();

// Setup express app
const app = express();

// logging config
morgan.token('error_obj', (req, res) => {
  if (res.statusCode !== 200) {
    return res.error;
  }
  return undefined;
});
morgan.format(
  'combined',
  '[:date[clf]] ":method :url HTTP/:http-version"'
  + ':status :res[content-length] ":referrer" ":user-agent" :error_obj'
);

// Config
app.use(boom());
app.use(morgan('combined'));
app.use(cors());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ limit: '6mb', extended: true }));
app.use(jsonBodyParser);
app.use(hsts({ maxAge: 31536000 }));

// v1 routes (limited Iceberg API endpoints only)
app.use('/v1', icebergRouter);

// default routes
app.use('/', icebergRouter);

// global 404 response when page is not found
app.use((_req, res) => {
  res.boom.notFound('requested page not found');
});

// catch all error handling
app.use((err, _req, res, _next) => {
  res.error = JSON.stringify(err, Object.getOwnPropertyNames(err));
  return res.boom.badImplementation('Something broke!');
});

// Initialize environment variables and start server
const startServer = async () => {
  await initEnvVars;
  const dynamoTableNames = JSON.parse(getRequiredEnvVar('dynamoTableNameString'));
  // Set Dynamo table names as environment variables
  Object.keys(dynamoTableNames).forEach((tableEnvVarName) => {
    process.env[tableEnvVarName] = dynamoTableNames[tableEnvVarName];
  });

  // Initialize singleton Knex client for Iceberg API
  await initializeKnexClient();

  const port = process.env.PORT || 5001;
  const icebergServer = app.listen(port, () => {
    log.info(`Iceberg API server listening on port ${port}`);
    log.info('Available endpoints: /version, /granules, /executions, /stats');
  });

  // Graceful shutdown handler
  const shutdown = (signal) => {
    log.info(`${signal} signal received: closing HTTP server and database connections`);
    icebergServer.close(async () => {
      log.info('HTTP server closed');
      try {
        await destroyKnexClient();
        log.info('Database connections closed');
        log.info('Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        log.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

// Start the server
log.info('Starting Iceberg API server');
startServer().catch((error) => {
  log.error('Failed to start Iceberg API server:', error);
  throw error;
});

module.exports = {
  app,
  initEnvVarsFunction,
  startServer,
};

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

const { initializeDuckDbClient, destroyDuckDbClient } = require('./iceberg-db');

const log = new Logger({ sender: '@api/iceberg-index' });

log.info('Initializing Iceberg API (DuckDB/Iceberg mode)');

// Load Environment Variables
const initEnvVarsFunction = async () => {
  if (inTestMode() && process.env.INIT_ENV_VARS_FUNCTION_TEST !== 'true') {
    return;
  }
  log.info('Initializing environment variables');
  const apiConfigSecretId = getRequiredEnvVar('api_config_secret_id');
  try {
    const response = await secretsManager().getSecretValue(
      { SecretId: apiConfigSecretId }
    );
    const envSecret = JSON.parse(response.SecretString);

    for (const [key, value] of Object.entries(envSecret)) {
      if (!(key in process.env)) {
        process.env[key] = String(value);
      }
    }
  } catch (error) {
    log.error(`Error setting environment variables from secret ${apiConfigSecretId}`, error);
    throw error;
  }
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

// v1 routes
app.use('/v1', icebergRouter);
app.use('/', icebergRouter);

app.use((_req, res) => {
  res.boom.notFound('requested page not found');
});

app.use((err, _req, res, _next) => {
  res.error = JSON.stringify(err, Object.getOwnPropertyNames(err));
  return res.boom.badImplementation('Internal Server Error');
});

/**
 * Initialize and start server
 */
const startServer = async () => {
  await initEnvVars;
  const dynamoTableNames = JSON.parse(getRequiredEnvVar('dynamoTableNameString'));
  Object.keys(dynamoTableNames).forEach((tableEnvVarName) => {
    process.env[tableEnvVarName] = dynamoTableNames[tableEnvVarName];
  });

  log.info('Initializing DuckDB...');
  await initializeDuckDbClient();

  const port = process.env.PORT || 5001;
  const icebergServer = app.listen(port, () => {
    log.info(`Iceberg API server listening on port ${port}`);
  });

  // Graceful shutdown handler
  const shutdown = (signal) => {
    log.info(`${signal} signal received: closing HTTP server and DuckDB connections`);
    icebergServer.close(async () => {
      log.info('HTTP server closed');
      try {
        await destroyDuckDbClient();
        log.info('DuckDB connections closed');
        log.info('Graceful shutdown complete');
      } catch (error) {
        log.error('Error during graceful shutdown:', error);
        throw error;
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

log.info('Starting Iceberg API server');
startServer().catch((error) => {
  log.error('Failed to start Iceberg API server:', error);
  throw error;
});

module.exports = {
  app,
  startServer,
};

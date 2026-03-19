'use strict';

const cors = require('cors');
const hsts = require('hsts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const express = require('express');
const morgan = require('morgan');

const awsServerlessExpress = require('aws-serverless-express');
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware');

const { getRequiredEnvVar } = require('@cumulus/common/env');
const { inTestMode } = require('@cumulus/common/test-utils');
const { secretsManager } = require('@cumulus/aws-client/services');
const Logger = require('@cumulus/logger');

const router = require('./routes');
const { jsonBodyParser } = require('./middleware');
const boom = require('../lib/expressBoom');
const { initializeKnexClient, destroyKnexClient } = require('./db');

const log = new Logger({ sender: '@api/index' });

// Load Environment Variables
// This should be done outside of the handler to minimize Secrets Manager calls.
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
      throw new SyntaxError(`Secret string returned for SecretId ${apiConfigSecretId} could not be parsed`, error);
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

// Only use serverless express middleware when running as Lambda
if (process.env.RUN_API_AS_SERVER !== 'true') {
  app.use(awsServerlessExpressMiddleware.eventContext());
}

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
// Setting limit to 6 MB which is the AWS lambda limit https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
app.use(bodyParser.urlencoded({ limit: '6mb', extended: true }));
app.use(jsonBodyParser);
app.use(hsts({ maxAge: 31536000 }));

// v1 routes
app.use('/v1', router);

// default routes
app.use('/', router);

// global 404 response when page is not found
app.use((_req, res) => {
  res.boom.notFound('requested page not found');
});

// catch all error handling
app.use((err, _req, res, _next) => {
  res.error = JSON.stringify(err, Object.getOwnPropertyNames(err));
  return res.boom.badImplementation('Something broke!');
});

// Create serverless express server only for Lambda mode (lazy initialization)
let server;
const getServer = () => {
  if (!server) {
    server = awsServerlessExpress.createServer(app);
  }
  return server;
};

const handler = async (event, context) => {
  await initEnvVars; // Wait for environment vars to resolve from initEnvVarsFunction
  const dynamoTableNames = JSON.parse(getRequiredEnvVar('dynamoTableNameString'));
  // Set Dynamo table names as environment variables for Lambda
  Object.keys(dynamoTableNames).forEach((tableEnvVarName) => {
    process.env[tableEnvVarName] = dynamoTableNames[tableEnvVarName];
  });

  // workaround to support multiValueQueryStringParameters
  // until this is fixed: https://github.com/awslabs/aws-serverless-express/issues/214
  const modifiedEvent = {
    ...event,
    queryStringParameters: event.multiValueQueryStringParameters || event.queryStringParameters,
  };
  log.info('Running serverlessExpress.proxy');
  // see https://github.com/vendia/serverless-express/issues/297
  return new Promise((resolve, reject) => {
    awsServerlessExpress.proxy(
      getServer(),
      modifiedEvent,
      { ...context, succeed: resolve, fail: reject }
    );
  });
};

// Initialize environment variables and start server for ECS deployment
const startServer = async () => {
  await initEnvVars; // Wait for environment vars to resolve from initEnvVarsFunction
  const dynamoTableNames = JSON.parse(getRequiredEnvVar('dynamoTableNameString'));
  // Set Dynamo table names as environment variables
  Object.keys(dynamoTableNames).forEach((tableEnvVarName) => {
    process.env[tableEnvVarName] = dynamoTableNames[tableEnvVarName];
  });

  // Initialize singleton Knex client for ECS mode
  await initializeKnexClient();

  const port = process.env.PORT || 5001;
  const ecsServer = app.listen(port, () => {
    log.info(`Cumulus API server listening on port ${port}`);
  });

  // Graceful shutdown handler
  const shutdown = (signal) => {
    log.info(`${signal} signal received: closing HTTP server and database connections`);
    ecsServer.close(async () => {
      log.info('HTTP server closed');
      await destroyKnexClient();
      log.info('Database connections closed');
      throw new Error(`Server shutting down due to ${signal}`);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

// If RUN_API_AS_SERVER is set to true, start as a standalone server
if (process.env.RUN_API_AS_SERVER === 'true') {
  log.info('Starting API as standalone server (ECS mode)');
  startServer().catch((error) => {
    log.error('Failed to start server:', error);
    throw error;
  });
}

module.exports = {
  app,
  initEnvVarsFunction,
  handler,
  startServer,
};

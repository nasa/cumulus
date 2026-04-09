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

const log = new Logger({ sender: '@api/index' });

let initEnvVars;

// Load Environment Variables
// This should be done outside of the handler to minimize Secrets Manager calls.
// Called once per Lambda container to minimize Secrets Manager calls
const initEnvVarsFunction = async () => {
  if (inTestMode() && process.env.INIT_ENV_VARS_FUNCTION_TEST !== 'true') {
    return undefined;
  }
  try {
    const apiConfigSecretId = process.env.api_config_secret_id || getRequiredEnvVar('api_config_secret_id');
    const secret = await secretsManager().getSecretValue({ SecretId: apiConfigSecretId });
    let envSecret;
    try {
      envSecret = JSON.parse(secret.SecretString);
    } catch (error) {
      throw new SyntaxError(`Secret string returned for SecretId ${apiConfigSecretId} could not be parsed`, error);
    }
    process.env = { ...envSecret, ...process.env };
    for (const [key, value] of Object.entries(envSecret)) {
      if (process.env[key] === undefined) {
        process.env[key] = String(value);
      }
    }
  } catch (error) {
    log.error('Encountered error trying to set environment variables', error);
    throw error;
  }
  log.info('Environment variables successfully initialized');
  return undefined;
};

const ensureEnvVarsInitialized = () => {
  if (initEnvVars === undefined) {
    initEnvVars = initEnvVarsFunction().catch((error) => {
      initEnvVars = undefined; // allow retry
      throw error;
    });
  }
  return initEnvVars;
};

// Setup express app
const app = express();
app.use(awsServerlessExpressMiddleware.eventContext());

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

// Config: Lazy load internal middlewares to ensure process.env is populated first
app.use((req, res, next) => {
  // eslint-disable-next-line global-require
  const boom = require('../lib/expressBoom');
  boom()(req, res, next);
});

app.use(morgan('combined'));
app.use(cors());
app.use(cookieParser());
// Setting limit to 6 MB which is the AWS lambda limit
app.use(bodyParser.urlencoded({ limit: '6mb', extended: true }));

app.use((req, res, next) => {
  // eslint-disable-next-line global-require
  const { jsonBodyParser } = require('./middleware');
  jsonBodyParser(req, res, next);
});

app.use(hsts({ maxAge: 31536000 }));

// Lazy load internal routes to ensure process.env is populated first
app.use('/v1', (req, res, next) => {
  // eslint-disable-next-line global-require
  const router = require('./routes');
  router(req, res, next);
});

app.use('/', (req, res, next) => {
  // eslint-disable-next-line global-require
  const router = require('./routes');
  router(req, res, next);
});

// global 404 response when page is not found
app.use((_req, res) => {
  res.boom.notFound('requested page not found');
});

// catch all error handling
app.use((err, _req, res, _next) => {
  res.error = JSON.stringify(err, Object.getOwnPropertyNames(err));
  return res.boom.badImplementation('Something broke!');
});

const server = awsServerlessExpress.createServer(app);

const handler = async (event, context) => {
  await ensureEnvVarsInitialized();

  const dynamoTableNames = JSON.parse(getRequiredEnvVar('dynamoTableNameString'));
  // Set Dynamo table names as environment variables for Lambda
  Object.keys(dynamoTableNames).forEach((tableEnvVarName) => {
    process.env[tableEnvVarName] = dynamoTableNames[tableEnvVarName];
  });

  // workaround to support multiValueQueryStringParameters
  const modifiedEvent = {
    ...event,
    queryStringParameters: event.multiValueQueryStringParameters || event.queryStringParameters,
  };

  log.info('Running serverlessExpress.proxy');

  return new Promise((resolve, reject) => {
    awsServerlessExpress.proxy(
      server,
      modifiedEvent,
      { ...context, succeed: resolve, fail: reject }
    );
  });
};

module.exports = {
  app,
  initEnvVarsFunction,
  handler,
};
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

// NOTE: require('./routes') and others were removed from here
// and moved inside the handler to ensure process.env is ready first.

const log = new Logger({ sender: '@api/index' });

let initEnvVars;

// Load Environment Variables
// This should be done outside of the handler to minimize Secrets Manager calls.
// Called once per Lambda container to minimize Secrets Manager calls
const initEnvVarsFunction = async () => {
  if (inTestMode() && process.env.INIT_ENV_VARS_FUNCTION_TEST !== 'true') {
    return undefined;
  } 
  
  // NOTE: Leaving your logic here exactly as provided
  try {
    const apiConfigSecretId = process.env.api_config_secret_id || getRequiredEnvVar('api_config_secret_id');
    const secret = await secretsManager().getSecretValue({ SecretId: apiConfigSecretId }).promise();
    let envSecret;
    try {
      envSecret = JSON.parse(secret.SecretString);
    } catch (error) {
      throw new SyntaxError(`Secret string returned for SecretId ${apiConfigSecretId} could not be parsed`, error);
    }
    process.env = { ...envSecret, ...process.env };
    // Allow explicitly set environment variables to override secret values.
    for (const [key, value] of Object.entries(envSecret)) {
      if (process.env[key] === undefined) {
        process.env[key] = String(value);
      }
    }
  } catch (error) {
    log.error(`Encountered error trying to set environment variables`, error);
    throw error;
  }
  log.info('Environment variables successfully initialized');
  return undefined;
};
initEnvVars = initEnvVarsFunction();

const ensureEnvVarsInitialized = () => {
  if (initEnvVars === undefined) {
    initEnvVars = initEnvVarsFunction().catch((error) => {
      initEnvVars = undefined; // allow retry
      throw error;
    });
  }
  return initEnvVars;
};

// Declare app and server globally to cache them across warm invocations
let app;
let server;

const handler = async (event, context) => {
  await initEnvVars; // Wait for environment vars to resolve from initEnvVarsFunction
  // Ensures environment variables are initialized once per container;
  // subsequent invocations reuse the result or allow for re-initialization on failure
  await ensureEnvVarsInitialized();
  
  const dynamoTableNames = JSON.parse(getRequiredEnvVar('dynamoTableNameString'));
  // Set Dynamo table names as environment variables for Lambda
  Object.keys(dynamoTableNames).forEach((tableEnvVarName) => {
    process.env[tableEnvVarName] = dynamoTableNames[tableEnvVarName];
  });

  // ONLY setup Express once, and ONLY after the environment variables are populated
  if (!server) {
    // IMPORTANT: Require routes and middleware here so they evaluate with populated process.env
    const router = require('./routes');
    const { jsonBodyParser } = require('./middleware');
    const boom = require('../lib/expressBoom');

    app = express();
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

    // Config
    app.use(boom());
    app.use(morgan('combined'));
    app.use(cors());
    app.use(cookieParser());
    // Setting limit to 6 MB which is the AWS lambda limit
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

    server = awsServerlessExpress.createServer(app);
  }

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
  app, // Note: For unit tests that import `app` directly, it will initially be undefined until handler runs.
  initEnvVarsFunction,
  handler,
};
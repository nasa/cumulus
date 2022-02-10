'use strict';

const cors = require('cors');
const hsts = require('hsts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const express = require('express');
const boom = require('express-boom');
const morgan = require('morgan');

const awsServerlessExpress = require('aws-serverless-express');
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware');

const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const Logger = require('@cumulus/logger');
const log = new Logger('@cumulus/api/index');
const { MissingRequiredEnvVar } = require('@cumulus/errors');

const router = require('./routes');
const { jsonBodyParser } = require('./middleware');

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

let dynamoTableNames;
const setupDynamoTablesConfig = async () => {
  const { dynamoTableNamesParameterKey } = process.env;
  if (!dynamoTableNamesParameterKey) {
    throw new MissingRequiredEnvVar('dynamoTableNamesParameterKey environment variable is required for API Lambda');
  }
  log.info('Getting dynamo table names from S3');
  dynamoTableNames = await getJsonS3Object(
    process.env.system_bucket,
    process.env.dynamoTableNamesParameterKey
  );
};

const setupDynamoTablesConfigPromise = setupDynamoTablesConfig();

// Config
app.use(boom());
app.use(morgan('combined'));
app.use(cors());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
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

const server = awsServerlessExpress.createServer(app);

const handler = async (event, context) => {
  await setupDynamoTablesConfigPromise;
  log.info('Starting API handler');
  // Set Dynamo table names as environment variables for Lambda
  Object.keys(dynamoTableNames).forEach((tableEnvVarName) => {
    process.env[tableEnvVarName] = dynamoTableNames[tableEnvVarName];
  });

  // workaround to support multiValueQueryStringParameters
  // untill this is fixed: https://github.com/awslabs/aws-serverless-express/issues/214
  const modifiedEvent = {
    ...event,
    queryStringParameters: event.multiValueQueryStringParameters || event.queryStringParameters,
  };
  log.info('Running serverlessExpress.proxy');
  // see https://github.com/vendia/serverless-express/issues/297
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
  handler,
};

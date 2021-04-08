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

const { services } = require('@cumulus/aws-client');
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
  const { dynamoTableNamesParameterName } = process.env;
  if (!dynamoTableNamesParameterName) {
    throw new MissingRequiredEnvVar('dynamoTableNamesParameterName environment variable is required for API Lambda');
  }

  const ssmClient = context.ssmClient || services.systemsManager();

  const dynamoTableNamesParameter = await ssmClient.getParameter({
    Name: dynamoTableNamesParameterName,
  }).promise();
  console.log(dynamoTableNamesParameter);
  const dynamoTableNames = JSON.parse(dynamoTableNamesParameter.Parameter.Value);
  console.log(dynamoTableNames);
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
  awsServerlessExpress.proxy(server, modifiedEvent, context);
};

module.exports = {
  app,
  handler,
};

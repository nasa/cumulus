/**
 * We are using a separate express for the distribution endpoint:  distributionApp
 * The separation of the cumulus api "app" from the distribution's "distributionApp"
 * is necessary to ensure there are two different endpoints
 *
 * For NASA deployments, cumulus API endpoints remain behind a
 * firewall and an authentication service.
 *
 * Distribution endpoints are intended for public use and are
 * publicly shared.
 */

'use strict';

const cors = require('cors');
const hsts = require('hsts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const express = require('express');
const boom = require('express-boom');
const awsServerlessExpress = require('aws-serverless-express');
const morgan = require('morgan');
const distributionRouter = require('./distribution-routes');

const distributionApp = express();

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
distributionApp.use(boom());
distributionApp.use(morgan('combined'));
distributionApp.use(cors());
distributionApp.use(cookieParser());
distributionApp.use(bodyParser.json()); // for parsing distributionApplication/json
distributionApp.use(hsts({ maxAge: 31536000 }));

distributionApp.use('/', distributionRouter);

// global 404 response when page is not found
distributionApp.use((req, res) => {
  res.boom.notFound('requested page not found');
});

// catch all error handling
distributionApp.use((err, req, res, _next) => {
  res.error = JSON.stringify(err, Object.getOwnPropertyNames(err));
  return res.boom.badImplementation('Something broke!');
});

const server = awsServerlessExpress.createServer(distributionApp, null);

module.exports = {
  distributionApp,
  handler: (event, context) => awsServerlessExpress.proxy(server, event, context)
};

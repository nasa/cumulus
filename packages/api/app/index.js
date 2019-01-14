'use strict';

const cors = require('cors');
const hsts = require('hsts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const express = require('express');
const boom = require('express-boom');

const awsServerlessExpress = require('aws-serverless-express');
const router = require('./routes');

const app = express();

// Config
app.use(boom());
app.use(cors());
app.use(cookieParser());
app.use(bodyParser.json()); // for parsing application/json
app.use(hsts({ maxAge: 31536000 }));

// v1 routs
app.use('/v1', router);

// default routes
app.use('/', router);

// global 404 response when page is not found
app.use((req, res) => {
  res.boom.notFound('requested page not found');
});

// catch all error handling
app.use((err, req, res) => {
  res.boom.badImplementation('Something broke!');
});

const server = awsServerlessExpress.createServer(app, null);

module.exports = {
  app,
  handler: (event, context) => awsServerlessExpress.proxy(server, event, context)
};

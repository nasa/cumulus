'use strict';

// The main application where routes are configured.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const docsHtml = require('./views/docs.html');
const expressValidator = require('express-validator');
const { es } = require('./aws');

const { handleError } = require('./api-errors');
const { handleWorkflowStatusRequest } = require('./workflows');
const { handleServiceStatusRequest } = require('./service-status');
const { handleProductStatusRequest } = require('./product-status');
const { handleReingestRequest } = require('./reingest');

const app = express();
app.use(compression());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// Setup code to allow rendering the documentation.curl http://uvsvuiocwk.execute-api.us-west-2.amazonaws.com/health
app.use(express.static('public'));
// this line must be immediately after any of the bodyParser middlewares
app.use(expressValidator());

module.exports = (cb = null) => {
  // Invoke the callback to allow it to configure the application before setting up routes.
  if (cb) cb(app);

  // Renders a view describing the API.
  app.get('/', (req, res) => {
    let apiUrl;
    if (req.apiGateway) {
      apiUrl = `https://${req.apiGateway.event.headers.Host}/${req.apiGateway.event.requestContext.stage}`;
    }
    else {
      // When running locally this is used.
      apiUrl = `http://${req.get('host')}`;
    }
    // Replace http://localhost:3000 with the apiUrl
    const html = docsHtml.replace(/http:\/\/localhost:3000/g, apiUrl);
    return res.send(html);
  });

  // Responds with the health of the application.
  app.get('/health', async (req, res) => {
    try {
      const esHealth = await es().ping();
      res.json({ elasticsearch: esHealth, 'ok?': esHealth });
    }
    catch (error) {
      handleError(error, req, res);
    }
  });

  app.get('/workflow_status', (req, res) => {
    handleWorkflowStatusRequest(req, res);
  });

  app.get('/service_status', (req, res) => {
    handleServiceStatusRequest(req, res);
  });

  app.get('/product_status', (req, res) => {
    handleProductStatusRequest(req, res);
  });

  app.post('/reingest_granule', (req, res) => {
    handleReingestRequest(req, res);
  });

  // Add an error handler last
  app.use(handleError);

  return app;
};

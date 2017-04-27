'use strict';

// The main application where routes are configured.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const docsHtml = require('./views/docs.html');
const expressValidator = require('express-validator');

const { handleError } = require('./api-errors');
const { handleWorkflowStatusRequest } = require('./workflows');

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
  app.get('/health', (req, res) => {
    res.json({ 'ok?': true });
  });

  app.get('/workflow_status', (req, res) => {
    handleWorkflowStatusRequest(req, res);
  });

  // Add an error handler last
  app.use(handleError);

  return app;
};

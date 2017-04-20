'use strict';

/*eslint no-console: ["error", { allow: ["warn", "error"] }] */

// The main application where routes are configured.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const docsHtml = require('./views/docs.html');
const User = require('./user');

const app = express();
app.use(compression());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// Setup code to allow rendering the documentation.curl http://uvsvuiocwk.execute-api.us-west-2.amazonaws.com/health
app.use(express.static('public'));

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
    // res.json({ 'ok?': true, foo: true });
    res.json({ 'ok?': true });
  });

  app.get('/users', (req, res) => {
    res.json(User.users);
  });

  app.get('/users/:userId', (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const user = User.getUser(User.users, userId);

    if (!user) return res.status(404).json({});

    return res.json(user);
  });

  // Add an error handler last
  app.use((err, req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({ errors: ['An internal error has occured.'] });
  });

  return app;
};

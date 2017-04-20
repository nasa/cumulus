'use strict';

// The main application where routes are configured.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const app = express();

// TODO change to markdown to document the API
const renderDocs = require("pug-loader!./views/docs.pug");

// app.set('view engine', 'pug');
// app.engine('pug', pug.__express);
app.use(compression());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

  return res.send(renderDocs({apiUrl: apiUrl}));
});

// Responds with the health of the application.
app.get('/health', (req, res) => {
  // res.json({ 'ok?': true, foo: true });
  res.json({ 'ok?': true });
});

const User = require('./user');

app.get('/users', (req, res) => {
  res.json(User.users);
});

app.get('/users/:userId', (req, res) => {
  const user = User.getUser(User.users, req.params.userId);

  if (!user) return res.status(404).json({});

  return res.json(user);
});

module.exports = app;

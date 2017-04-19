'use strict';

// The main application where routes are configured.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const app = express();

app.set('view engine', 'pug');
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
  res.render('index', {
    apiUrl: apiUrl
  });
});

// Responds with the health of the application.
app.get('/health', (req, res) => {
  // res.json({ 'ok?': true, foo: true });
  res.json({ 'ok?': true });
});

// Ephemeral in-memory data store
const users = [{
  id: 1,
  name: 'Joe'
}, {
  id: 2,
  name: 'Jane'
}];

let userIdCounter = users.length;

const getUser = userId => users.find(u => u.id === parseInt(userId, 10));
const getUserIndex = userId => users.findIndex(u => u.id === parseInt(userId, 10));


app.get('/users', (req, res) => {
  res.json(users);
});

app.get('/users/:userId', (req, res) => {
  const user = getUser(req.params.userId);

  if (!user) return res.status(404).json({});

  return res.json(user);
});

app.post('/users', (req, res) => {
  userIdCounter += 1;
  const user = {
    id: userIdCounter,
    name: req.body.name
  };
  users.push(user);
  return res.status(201).json(user);
});

app.put('/users/:userId', (req, res) => {
  const user = getUser(req.params.userId);

  if (!user) return res.status(404).json({});

  user.name = req.body.name;
  return res.json(user);
});

app.delete('/users/:userId', (req, res) => {
  const userIndex = getUserIndex(req.params.userId);

  if (userIndex === -1) return res.status(404).json({});

  users.splice(userIndex, 1);
  return res.json(users);
});

// The aws-serverless-express library creates a server and listens on a Unix
// Domain Socket for you, so you can remove the usual call to app.listen.
// app.listen(3000)

// Export your express server so you can import it in the lambda function.
module.exports = app;

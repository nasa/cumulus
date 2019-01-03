'use strict';

const cors = require('cors')
const hsts = require('hsts')
const bodyParser = require('body-parser');
const express = require('express')
const boom = require('express-boom')

const router = require('./routes')

const awsServerlessExpress = require('aws-serverless-express')
const app = express()

// Config
app.use(boom())
app.use(cors())
app.use(bodyParser.json()); // for parsing application/json
app.use(hsts({ maxAge: 31536000 }))

app.use('/', router)


// catch all error handling
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.boom.badImplementation('Something broke!')
});

const server = awsServerlessExpress.createServer(app, null)

module.exports = {
  app,
  handler: (event, context) => awsServerlessExpress.proxy(server, event, context)
}

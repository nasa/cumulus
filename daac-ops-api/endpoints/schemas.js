'use strict';

const _get = require('lodash.get');
const schemas = require('../schemas');
const handle = require('../response').handle;

function get(event, cb) {
  const schemaName = _get(event.pathParameters, 'schemaName');

  return cb(null, schemas[schemaName]);
}

function handler(event, context) {
  handle(event, context, true, (cb) => {
    get(event, cb);
  });
}

module.exports = handler;

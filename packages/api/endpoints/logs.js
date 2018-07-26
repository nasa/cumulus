'use strict';

const _get = require('lodash.get');
const handle = require('../lib/response').handle;
const { Search } = require('../es/search');
const AWS = require('aws-sdk');
const {
  aws: { cloudwatchlogs }
} = require('@cumulus/common');

function count(event, cb) {
  return cb(null, {});
}

function list(event, cb) {
  const search = new Search(event, 'logs');
  return search.query().then((response) => cb(null, response)).catch((e) => {
    cb(e);
  });
}

/**
 * Query logs from a single function.
 *
 * @param {Object} event - aws lambda event object.
 * @param {callback} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function get(event, cb) {
  const executionName = event.pathParameters.executionName;

  const search = new Search({
    queryStringParameters: {
      limit: 50,
      executions: executionName
    }
  }, 'logs');
  return search.query().then((response) => cb(null, response)).catch((e) => {
    cb(e);
  });
}

function handler(event, context) {
  return handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.resource === '/stats/logs') {
      return count(event, cb);
    }
    else if (event.httpMethod === 'GET' && event.pathParameters.executionName) {
      return get(event, cb);
    }

    return list(event, cb);
  });
}

module.exports = handler;

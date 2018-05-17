'use strict';

const _get = require('lodash.get');
const { inTestMode } = require('@cumulus/common/test-utils');
const handle = require('../lib/response').handle;
const Search = require('../es/search').Search;
const models = require('../models');

/**
 * List and search executions
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function list(event, cb) {
  const search = new Search(event, 'execution');
  return search.query().then((response) => cb(null, response)).catch((e) => {
    cb(e);
  });
}

/**
 * get a single PDR
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function get(event, cb) {
  const arn = _get(event.pathParameters, 'arn');

  const e = new models.Execution();

  return e.get({ arn }).then((response) => {
    cb(null, response);
  }).catch(cb);
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 * @param {Object} context - aws context object
 * @returns {undefined} undefined
 */
function handler(event, context) {
  return handle(event, context, !inTestMode() /* authCheck */, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      return get(event, cb);
    }

    return list(event, cb);
  });
}

module.exports = handler;

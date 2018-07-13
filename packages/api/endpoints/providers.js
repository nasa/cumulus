/* eslint-disable no-param-reassign */

'use strict';

const _get = require('lodash.get');
const { inTestMode } = require('@cumulus/common/test-utils');
const { handle } = require('../lib/response');
const models = require('../models');
const RecordDoesNotExist = require('../lib/errors').RecordDoesNotExist;
const { Search } = require('../es/search');

/**
 * List all providers
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} search response
 */
function list(event, cb) {
  const search = new Search(event, 'provider');
  return search.query()
    .then((response) => cb(null, response))
    .catch(cb);
}

/**
 * Query a single provider
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} a single provider object
 */
function get(event, cb) {
  const id = _get(event.pathParameters, 'id');
  if (!id) {
    return cb('provider id is missing');
  }

  const p = new models.Provider();
  return p.get({ id })
    .then((res) => {
      delete res.password;
      cb(null, res);
    })
    .catch(cb);
}

/**
 * Creates a new provider
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} returns the created provider
 */
function post(event, cb) {
  const data = JSON.parse(event.body || {});
  const id = data.id;

  const p = new models.Provider();

  return p.get({ id })
    .then(() => cb({ message: `A record already exists for ${id}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return p.create(data)
          .then((record) => cb(null, { record, message: 'Record saved' }))
          .catch(cb);
      }
      return cb(e);
    });
}

/**
 * Updates an existing provider
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} returns updated provider
 */
function put(event, cb) {
  const id = _get(event.pathParameters, 'id');

  if (!id) {
    return cb('provider id is missing');
  }

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  const p = new models.Provider();

  // get the record first
  return p.get({ id })
    .then(() => p.update({ id }, data))
    .then((d) => cb(null, d))
    .catch((err) => {
      if (err instanceof RecordDoesNotExist) return cb({ message: 'Record does not exist' });
      return cb(err);
    });
}

/**
 * Delete a provider
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} returns delete response
 */
function del(event, cb) {
  const id = _get(event.pathParameters, 'id');
  const p = new models.Provider();

  return p.get({ id })
    .then(() => p.delete({ id }))
    .then(() => cb(null, { message: 'Record deleted' }))
    .catch(cb);
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
    else if (event.httpMethod === 'POST') {
      return post(event, cb);
    }
    else if (event.httpMethod === 'PUT' && event.pathParameters) {
      return put(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      return del(event, cb);
    }

    return list(event, cb);
  });
}

module.exports = handler;

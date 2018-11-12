'use strict';

const { handle } = require('../lib/response');
const models = require('../models');
const {
  AssociatedRulesError,
  RecordDoesNotExist
} = require('../lib/errors');
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
  const id = event.pathParameters.id;
  if (!id) {
    return cb('provider id is missing');
  }

  const providerModel = new models.Provider();
  return providerModel.get({ id })
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

  const providerModel = new models.Provider();

  return providerModel.get({ id })
    .then(() => cb({ message: `A record already exists for ${id}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return providerModel.create(data)
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
  const id = event.pathParameters.id;

  if (!id) {
    return cb('provider id is missing');
  }

  const data = event.body
    ? JSON.parse(event.body)
    : {};

  const providerModel = new models.Provider();

  // get the record first
  return providerModel.get({ id })
    .then(() => providerModel.update({ id }, data))
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
async function del(event, cb) {
  const providerModel = new models.Provider();

  try {
    await providerModel.delete(event.pathParameters.id);
  }
  catch (err) {
    if (err instanceof AssociatedRulesError) {
      const message = `Cannot delete provider with associated rules: ${err.rules.join(', ')}`;
      return cb({ message }, null, 409);
    }

    return cb(err);
  }

  return cb(null, { message: 'Record deleted' });
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 * @param {Object} context - aws context object
 * @returns {undefined} undefined
 */
function handler(event, context) {
  return handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      return get(event, cb);
    }
    if (event.httpMethod === 'POST') {
      return post(event, cb);
    }
    if (event.httpMethod === 'PUT' && event.pathParameters) {
      return put(event, cb);
    }
    if (event.httpMethod === 'DELETE' && event.pathParameters) {
      return del(event, cb);
    }

    return list(event, cb);
  });
}

module.exports = handler;

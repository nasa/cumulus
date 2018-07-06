'use strict';

const { inTestMode } = require('@cumulus/common/test-utils');
const { handle } = require('../lib/response');
const models = require('../models');
const { RecordDoesNotExist } = require('../lib/errors');
const { Search } = require('../es/search');

/**
 * List all rules.
 *
 * @param {Object} event - aws lambda event object.
 * @param {function} cb - aws lambda callback function
 * @returns {Object} list of rules
 */
function list(event, cb) {
  const search = new Search(event, 'rule');
  return search.query().then((response) => cb(null, response)).catch(cb);
}

/**
 * Query a single rule.
 *
 * @param {Object} event - aws lambda event object.
 * @param {function} cb - aws lambda callback function
 * @returns {Object} a single granule object.
 */
function get(event, cb) {
  const name = event.pathParameters.name;

  const model = new models.Rule();
  return model.get({ name })
    .then((res) => {
      delete res.password;
      cb(null, res);
    })
    .catch(cb);
}

/**
 * Creates a new rule
 *
 * @param {Object} event - aws lambda event object.
 * @param {function} cb - aws lambda callback function
 * @returns {Object} returns the collection that was just saved.
 */
function post(event, cb) {
  const data = JSON.parse(event.body || {});
  const name = data.name;

  const model = new models.Rule();

  return model.get({ name })
    .then(() => cb({ message: `A record already exists for ${name}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return model.create(data)
          .then((r) => cb(null, { message: 'Record saved', record: r }))
          .catch(cb);
      }
      return cb(e);
    });
}

/**
 * Updates an existing rule
 *
 * @param {Object} event - aws lambda event object.
 * @param {function} cb - aws lambda callback function
 * @returns {Object} a mapping of the updated properties.
 */
async function put(event, cb) {
  const name = event.pathParameters.name;

  const data = JSON.parse(event.body || {});
  const action = data.action;

  const model = new models.Rule();

  // get the record first
  let originalData;
  try {
    originalData = await model.get({ name });
  }
  catch (e) {
    if (e instanceof RecordDoesNotExist) return cb({ message: 'Record does not exist' });
    return cb(e);
  }

  // if rule type is onetime no change is allowed unless it is a rerun
  if (action === 'rerun') {
    await models.Rule.invoke(originalData);
    return cb(null, originalData);
  }

  return model.update(originalData, data)
    .then((d) => cb(null, d))
    .catch((err) => cb(err));
}

/**
 * deletes a rule
 *
 * @param {Object} event - aws lambda event object.
 * @param {function} cb - aws lambda callback function
 * @returns {Object} returns the collection that was just saved.
 */
async function del(event, cb) {
  const name = (event.pathParameters.name || '').replace(/%20/g, ' ');
  const model = new models.Rule();

  return model.get({ name })
    .then((record) => model.delete(record))
    .then(() => cb(null, { message: 'Record deleted' }))
    .catch((err) => cb(err));
}

/**
 * Looks up the httpMethod in the lambda event and performs rule's operations accordingly
 *
 * @param {Object} event - lambda event
 * @param {Object} context - lambda context
 * @returns {(error|string)} Success message or error
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

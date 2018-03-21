/* eslint-disable no-param-reassign */
'use strict';

const _get = require('lodash.get');
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
  search.query().then((response) => cb(null, response)).catch(cb);
}

/**
 * Query a single rule.
 *
 * @param {Object} event - aws lambda event object.
 * @param {function} cb - aws lambda callback function
 * @returns {Object} a single granule object.
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');

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
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const name = _get(data, 'name');

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
  const name = _get(event.pathParameters, 'name');

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const action = _get(data, 'action');

  const model = new models.Rule();

  // if the data includes any fields other than state and rule.value
  // throw error
  if (action && action !== 'rerun') {
    let check = Object.keys(data).filter((f) => (f !== 'state' && f !== 'rule'));
    if (data.rule) check = check.concat(Object.keys(data.rule).filter((f) => f !== 'value'));

    if (check.length > 0) return cb({ message: 'Only state and rule.value values can be changed' });
  }

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
    return cb(originalData);
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
  let name = _get(event.pathParameters, 'name', '');
  const model = new models.Rule();

  name = name.replace(/%20/g, ' ');

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
      get(event, cb);
    }
    else if (event.httpMethod === 'POST') {
      post(event, cb);
    }
    else if (event.httpMethod === 'PUT' && event.pathParameters) {
      put(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      del(event, cb);
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;

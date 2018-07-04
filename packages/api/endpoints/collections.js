'use strict';

const _get = require('lodash.get');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { inTestMode } = require('@cumulus/common/test-utils');
const log = require('@cumulus/common/log');
const { handle } = require('../lib/response');
const models = require('../models');
const Collection = require('../es/collections');
const RecordDoesNotExist = require('../lib/errors').RecordDoesNotExist;
const examplePayload = require('../tests/data/collections_post.json');

/**
 * List all collections.
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} the API list response
 */
function list(event, cb) {
  const collection = new Collection(event);
  return collection.query().then((res) => cb(null, res)).catch(cb);
}

/**
 * Query a single collection.
 * 
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} a collection record
 */
function get(event, cb) {
  const dataType = _get(event.pathParameters, 'dataType');
  const version = _get(event.pathParameters, 'version');
  const c = new models.Collection();
  return c.get({ dataType, version })
    .then((res) => {
      const collection = new Collection(event);
      return collection.getStats([res], [res.dataType]);
    })
    .then((res) => cb(null, res[0]))
    .catch(cb);
}

/**
 * Creates a new collection
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} a the posted collection record
 */
function post(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const dataType = _get(data, 'dataType');
  const version = _get(data, 'version');

  // make sure primary key is included
  if (!data.dataType || !data.version) {
    return cb({ message: 'Field name and/or version is missing' });
  }
  const c = new models.Collection();

  return c.get({ dataType, version })
    .then(() => cb({ message: `A record already exists for ${dataType} version: ${version}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return c.create(data)
          .then(() => cb(null, { message: 'Record saved', record: data }))
          .catch(cb);
      }
      return cb(e);
    });
}

/**
 * Updates an existing collection
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} a the updated collection record
 */
function put(event, cb) {
  const pname = _get(event.pathParameters, 'dataType');
  const pversion = _get(event.pathParameters, 'version');

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  const dataType = _get(data, 'dataType');
  const version = _get(data, 'version');

  if (pname !== dataType || pversion !== version) {
    return cb({ message: 'dataType and version in path doesn\'t match the payload' });
  }

  const c = new models.Collection();

  // get the record first
  return c.get({ dataType, version })
    .then((originalData) => {
      data = Object.assign({}, originalData, data);
      return c.create(data);
    })
    .then(() => cb(null, data))
    .catch((err) => {
      if (err instanceof RecordDoesNotExist) {
        return cb({ message: 'Record does not exist' });
      }
      return cb(err);
    });
}

/**
 * Delete a collection record
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} a message showing the record is deleted
 */
function del(event, cb) {
  const dataType = _get(event.pathParameters, 'dataType');
  const version = _get(event.pathParameters, 'version');
  const c = new models.Collection();

  return c.get({ dataType, version })
    .then(() => c.delete({ dataType, version }))
    .then(() => cb(null, { message: 'Record deleted' }))
    .catch(cb);
}

function handler(event, context) {
  const httpMethod = _get(event, 'httpMethod');

  if (!httpMethod) {
    return context.fail('HttpMethod is missing');
  }

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

justLocalRun(() => {
  handler(examplePayload, {
    succeed: (r) => log.error(r),
    failed: (e) => log.error(e)
  }, (e, r) => log.error(e, r));
});

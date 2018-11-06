'use strict';

const { handle } = require('../lib/response');
const models = require('../models');
const Collection = require('../es/collections');
const RecordDoesNotExist = require('../lib/errors').RecordDoesNotExist;

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
  const name = event.pathParameters.collectionName;
  const version = event.pathParameters.version;

  const c = new models.Collection();
  return c.get({ name, version })
    .then((res) => {
      const collection = new Collection(event);
      return collection.getStats([res], [res.name]);
    })
    .then((res) => cb(null, res[0]))
    .catch((err) => {
      if (err.name === 'RecordDoesNotExist') return cb(null, null, 404);

      return cb(err);
    });
}

/**
 * Creates a new collection
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {Promise<Object>} a the posted collection record
 */
function post(event, cb) {
  const data = event.body
    ? JSON.parse(event.body)
    : {};

  const name = data.name;
  const version = data.version;

  // make sure primary key is included
  if (!name || !version) {
    return cb({ message: 'Field name and/or version is missing' });
  }
  const c = new models.Collection();

  return c.get({ name, version })
    .then(() => cb({ message: `A record already exists for ${name} version: ${version}` }))
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
  const pname = event.pathParameters.collectionName;
  const pversion = event.pathParameters.version;

  let data = event.body
    ? JSON.parse(event.body)
    : {};

  const name = data.name;
  const version = data.version;

  if (pname !== name || pversion !== version) {
    return cb({ message: "name and version in path doesn't match the payload" });
  }

  const c = new models.Collection();

  // get the record first
  return c.get({ name, version })
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
  const name = event.pathParameters.collectionName;
  const version = event.pathParameters.version;
  const c = new models.Collection();

  return c.get({ name, version })
    .then(() => c.delete({ name, version }))
    .then(() => cb(null, { message: 'Record deleted' }))
    .catch(cb);
}

/**
 * Handle an API Gateway collections request
 *
 * @param {Object} event - an API Gateway Lambda request
 * @param {Object} context - an API Gateway Lambda context
 * @returns {Promise} a different promise depending on which action was invoked
 */
function handleRequest(event, context) {
  return handle(event, context, true, (cb) => {
    const httpMethod = event.httpMethod;

    if (httpMethod === 'GET' && event.pathParameters) {
      return get(event, cb);
    }
    if (httpMethod === 'POST') {
      return post(event, cb);
    }
    if (httpMethod === 'PUT' && event.pathParameters) {
      return put(event, cb);
    }
    if (httpMethod === 'DELETE' && event.pathParameters) {
      return del(event, cb);
    }
    return list(event, cb);
  });
}

module.exports = handleRequest;

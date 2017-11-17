'use strict';

const _get = require('lodash.get');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const logger = require('@cumulus/ingest/log');
const { handle } = require('../lib/response');
const models = require('../models');
const Collection = require('../es/collections');
const RecordDoesNotExist = require('../lib/errors').RecordDoesNotExist;
const examplePayload = require('../tests/data/collections_post.json');
const { indexCollection, deleteRecord } = require('../es/indexer');

const log = logger.child({ file: 'daac-ops-api/endpionts/collections.js' });

/**
 * List all collections.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const collection = new Collection(event);
  collection.query().then(res => cb(null, res)).catch((e) => {
    cb(e);
  });
}

/**
 * Query a single collection.
 * @param {object} event aws lambda event object.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'collectionName');
  const version = _get(event.pathParameters, 'version');

  const c = new models.Collection();
  return c.get({ name, version })
    .then((res) => {
      const collection = new Collection(event);
      return collection.getStats([res], [res.name]);
    }).then(res => cb(null, res[0]))
      .catch((e) => cb(e));
}

/**
 * Creates a new collection
 * @param {object} event aws lambda event object.
 * @return {object} returns the collection that was just saved.
 */
function post(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const name = _get(data, 'name');
  const version = _get(data, 'version');

  // make sure primary key is included
  if (!data.name || !data.version) {
    return cb({ message: 'Field name and/or version is missing' });
  }
  const c = new models.Collection();

  return c.get({ name, version })
    .then(() => cb({ message: `A record already exists for ${name} version: ${version}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return c.create(data)
          .then(() => Collection.es())
          .then(esClient => indexCollection(esClient, data))
          .then(() => cb(null, { message: 'Record saved', record: data }))
          .catch(err => cb(err));
      }
      return cb(e);
    });
}

/**
 * Updates an existing collection
 * @param {object} body a set of properties to update on an existing collection.
 * @return {object} a mapping of the updated properties.
 */
function put(event, cb) {
  const pname = _get(event.pathParameters, 'collectionName');
  const pversion = _get(event.pathParameters, 'version');

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  const name = _get(data, 'name');
  const version = _get(data, 'version');

  if (pname !== name || pversion !== version) {
    return cb({ message: 'name and version in path doesn\'t match the payload' });
  }

  const c = new models.Collection();

  // get the record first
  return c.get({ name, version }).then((originalData) => {
    data = Object.assign({}, originalData, data);
    return c.create(data);
  }).then(() => Collection.es())
    .then(esClient => indexCollection(esClient, data))
    .then(() => cb(null, data))
    .catch((err) => {
      if (err instanceof RecordDoesNotExist) {
        return cb({ message: 'Record does not exist' });
      }
      return cb(err);
    });
}

function del(event, cb) {
  const name = _get(event.pathParameters, 'collectionName');
  const version = _get(event.pathParameters, 'version');
  const id = `${name}___${version}`;
  const c = new models.Collection();

  return c.get({ name, version })
    .then(() => c.delete({ name, version }))
    .then(() => Collection.es())
    .then((esClient) => deleteRecord(esClient, id, 'collection'))
    .then(() => cb(null, { message: 'Record deleted' }))
    .catch(e => cb(e));
}

function handler(event, context) {
  const httpMethod = _get(event, 'httpMethod');
  if (!httpMethod) {
    return context.fail('HttpMethod is missing');
  }

  return handle(event, context, true, (cb) => {
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

justLocalRun(() => {
  handler(examplePayload, {
    succeed: r => log.error(r),
    failed: e => log.error(e)
  }, (e, r) => log.error(e, r));
});

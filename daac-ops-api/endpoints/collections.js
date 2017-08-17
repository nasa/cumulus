'use strict';

const _get = require('lodash.get');
const handle = require('../lib/response').handle;
const models = require('../models');
const Search = require('../es/search').Search;
const RecordDoesNotExist = require('../lib/errors').RecordDoesNotExist;

/**
 * List all collections.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, process.env.CollectionsTable);
  search.query().then(res => cb(null, res)).catch((e) => {
    cb(e);
  });
}

/**
 * Query a single collection.
 * @param {object} event aws lambda event object.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const collectionName = _get(event.pathParameters, 'short_name');
  if (!collectionName) {
    return cb('collectionName is missing');
  }

  const search = new Search({}, process.env.CollectionsTable);
  return search.get(collectionName)
    .then(res => cb(null, res))
    .catch(e => cb(e));
}

/**
 * Creates a new collection
 * @param {object} event aws lambda event object.
 * @return {object} returns the collection that was just saved.
 */
function post(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  // make sure primary key is included
  if (!data.collectionName) {
    return cb('Field collectionName is missing');
  }
  const collectionName = data.collectionName;

  const c = new models.Collection();

  return c.get({ collectionName: collectionName })
    .then(() => cb(`A record already exists for ${collectionName}`))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return c.create(data).then(() => {
          cb(null, {
            detail: 'Record saved',
            record: data
          });
        }).catch(err => cb(err));
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
  const collectionName = _get(event.pathParameters, 'short_name');
  if (!collectionName) {
    return cb('collectionName is missing');
  }

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  const c = new models.Collection();

  // get the record first
  return c.get({ collectionName: collectionName }).then((originalData) => {
    data = Object.assign({}, originalData, data);
    return c.create(data);
  }).then(r => cb(null, r)).catch((err) => {
    if (err instanceof RecordDoesNotExist) {
      return cb('Record does not exist');
    }
    return cb(err);
  });
}

function del(event, cb) {
  const collectionName = _get(event.pathParameters, 'short_name');
  const c = new models.Collection();

  return c.get({ collectionName }).then(() => {
    // check if there are any granules associated with this collection
    // do not delete if there are granules
    const params = {
      queryStringParameters: {
        fields: 'granuleId',
        collectionName,
        limit: 1
      }
    };

    const search = new Search(params, process.env.GranulesTable);
    return search.query();
  }).then((r) => {
    if (r.meta.count > 0) {
      throw new Error('Cannot delete this collection while there are granules associated with it');
    }

    return c.delete({ collectionName });
  }).then(() => cb(null, { detail: 'Record deleted' }))
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

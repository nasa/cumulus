'use strict';

const _get = require('lodash.get');
const handle = require('../response').handle;
const models = require('../models');
const Search = require('../es/search').Search;
const RecordDoesNotExist = require('../errors').RecordDoesNotExist;

/**
 * List all providers.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, process.env.ProvidersTable);
  search.query().then(response => cb(null, response)).catch((e) => {
    cb(e);
  });
}

/**
 * Query a single provider.
 * @param {object} event aws lambda event object.
 * @param {string} granuleId the id of the granule.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');
  if (!name) {
    return cb('provider name is missing');
  }

  const search = new Search({}, process.env.ProvidersTable);
  return search.get(name)
    .then(response => cb(null, response))
    .catch(e => cb(e));
}

/**
 * Creates a new provider
 * @param {object} event aws lambda event object.
 * @return {object} returns the collection that was just saved.
 */
function post(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  // make sure primary key is included
  if (!data.name) {
    return cb('Field name is missing');
  }
  const name = data.name;

  const p = new models.Provider();

  return p.get({ name: name })
    .then(() => cb(`A record already exists for ${name}`))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return p.create(data).then(() => {
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
 * Updates an existing provider
 * @param {object} event aws lambda event object.
 * @return {object} a mapping of the updated properties.
 */
function put(event, cb) {
  const name = _get(event.pathParameters, 'name');
  if (!name) {
    return cb('provider name is missing');
  }

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  const p = new models.Provider();

  // get the record first
  return p.get({ name }).then((originalData) => {
    data = Object.assign({}, originalData, data);

    // handle restart case
    if (data.action === 'restart') {
      return p.restart(name)
        .then(r => cb(null, r))
        .catch(e => cb(e));
    }

    // handle stop case
    if (data.action === 'stop') {
      return p.update(
        { name },
        { status: 'stopped', isActive: false }
      );
    }

    // otherwise just update
    return p.update({ name }, data);
  }).then(r => cb(null, r)).catch((err) => {
    if (err instanceof RecordDoesNotExist) {
      return cb('Record does not exist');
    }
    return cb(err);
  });
}

function del(event, cb) {
  const name = _get(event.pathParameters, 'name');
  const p = new models.Provider();

  return p.get({ name })
    .then(() => p.delete({ name }))
    .then(() => cb(null, { detail: 'Record deleted' }))
    .catch(e => cb(e));
}

function handler(event, context) {
  handle(event, context, true, (cb) => {
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

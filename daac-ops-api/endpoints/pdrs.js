'use strict';

const _get = require('lodash.get');
const handle = require('../response').handle;
const models = require('../models');
const Search = require('../es/search').Search;

/**
 * List all PDRs.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, process.env.PDRsTable);
  search.query().then(response => cb(null, response)).catch((e) => {
    cb(e);
  });
}

/**
 * Query a single PDR.
 * @param {string} collectionName the name of the collection.
 * @param {string} granuleId the id of the granule.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'pdrName');
  if (!name) {
    return cb('PDR#get requires a pdrName property');
  }

  const search = new Search({}, process.env.PDRsTable);
  return search.get(name).then((response) => {
    // return PDRD message if pdrd query is made
    if (event.queryStringParameters && event.queryStringParameters.pdrd) {
      if (response.PDRD) {
        return cb(null, response.PDRD);
      }
      return cb(null, 'No PDRD Generated');
    }

    return cb(null, response);
  }).catch((e) => {
    cb(e);
  });
}

function del(event, cb) {
  const pdrName = _get(event.pathParameters, 'pdrName');
  const p = new models.Pdr();

  return p.get({ pdrName })
    .then(() => p.delete({ pdrName }))
    .then(() => cb(null, { detail: 'Record deleted' }))
    .catch(e => cb(e));
}

function handler(event, context) {
  handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      return get(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      return del(event, cb);
    }

    return list(event, cb);
  });
}

module.exports = handler;

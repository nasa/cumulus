'use strict';

const _get = require('lodash.get');
const handle = require('../response').handle;
const models = require('../models');
const Search = require('../es/search').Search;

/**
 * List all granules for a given collection.
 * @param {object} event aws lambda event object.
 * @param {object} context aws lambda context object
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, process.env.GranulesTable);
  search.query().then(response => cb(null, response)).catch((e) => {
    cb(e);
  });
}

function put(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  const action = _get(data, 'action', null);
  const step = _get(data, 'step', 0);

  if (action) {
    const granuleId = _get(event.pathParameters, 'granuleName');
    const g = new models.Granule();

    return g.get({ granuleId: granuleId }).then((record) => {
      if (action === 'reprocess') {
        return g.reprocess(record, step).then(() => ({ StatusCode: 202, Payload: '' }));
      }
      else if (action === 'reingest') {
        return g.reingest(granuleId);
      }
      else if (action === 'removeFromCmr') {
        if (!record.published) {
          throw new Error('The granule is not published to CMR');
        }

        return g.unpublish(granuleId, record.cmrProvider);
      }
      throw new Error(`Action <${action}> is not supported`);
    }).then(r => cb(null, r)).catch(e => cb(e));
  }

  return cb('action is missing');
}

function del(event, cb) {
  const granuleId = _get(event.pathParameters, 'granuleName');
  const g = new models.Granule();

  return g.get({ granuleId: granuleId }).then((record) => {
    if (record.published) {
      throw new Error(
        'You cannot delete a granule that is published to CMR. Remove it from CMR first'
      );
    }

    return g.delete({ granuleId: granuleId });
  }).then(() => cb(null, { detail: 'Record deleted' })).catch(e => cb(e));
}

/**
 * Query a single granule.
 * @param {string} collectionName the name of the collection.
 * @param {string} granuleId the id of the granule.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const granuleId = _get(event.pathParameters, 'granuleName');

  const search = new Search({}, process.env.GranulesTable);
  search.get(granuleId).then((response) => {
    cb(null, response);
  }).catch((e) => {
    cb(e);
  });
}


function handler(event, context) {
  handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      get(event, cb);
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

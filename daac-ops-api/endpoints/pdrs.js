'use strict';

const _get = require('lodash.get');
const { S3 } = require('@cumulus/ingest/aws');
const { deleteRecord } = require('../es/indexer');
const handle = require('../lib/response').handle;
const Search = require('../es/search').Search;

/**
 * List all granules for a given collection.
 * @param {object} event aws lambda event object.
 * @param {object} context aws lambda context object
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, 'pdr');
  search.query().then(response => cb(null, response)).catch((e) => {
    cb(e);
  });
}

/**
 * Query a single granule.
 * @param {object} event aws lambda event object.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const pdrName = _get(event.pathParameters, 'pdrName');

  const search = new Search({}, 'pdr');
  search.get(pdrName).then((response) => {
    cb(null, response);
  }).catch((e) => {
    cb(e);
  });
}

async function del(event) {
  const pdrName = _get(event.pathParameters, 'pdrName');

  const search = new Search({}, 'pdr');
  const record = await search.get(pdrName);

  if (record.detail) {
    throw record;
  }

  await deleteRecord(null, pdrName, 'pdr');

  // remove file from s3
  try {
    const key = `pdrs/${pdrName}`;
    await S3.delete(process.env.internal, key);
  }
  catch (e) {
    console.log(e);
  }

  return { detail: 'Record deleted' };
}

function handler(event, context) {
  handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      get(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      del(event).then(r => cb(null, r)).catch(e => cb(e));
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;

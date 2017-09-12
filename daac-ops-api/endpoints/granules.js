'use strict';

const _get = require('lodash.get');
const { invoke } = require('@cumulus/ingest/aws');
const handle = require('../lib/response').handle;
const Search = require('../es/search').Search;
const { partialRecordUpdate } = require('../es/indexer');
const Rule = require('../models/rules');

/**
 * List all granules for a given collection.
 * @param {object} event aws lambda event object.
 * @param {object} context aws lambda context object
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, 'granule');
  search.query().then(response => cb(null, response)).catch((e) => {
    cb(e);
  });
}


/**
 * Update a single granule.
 * Supported Actions: Reprocess, Remove From CMR.
 *
 * @param {object} event aws lambda event object.
 * @return {Promise}
 */
async function put(event) {
  const granuleId = _get(event.pathParameters, 'granuleName');
  let body = _get(event, 'body', '{}');
  body = JSON.parse(body);

  const action = _get(body, 'action');

  if (action) {
    const search = new Search({}, 'granule');
    const response = await search.get(granuleId);
    if (action === 'reingest') {
      const collection = response.collectionId.split('___');
      const payload = await Rule.buildPayload({
        workflow: 'IngestGranule',
        provider: response.provider,
        collection: {
          name: collection[0],
          version: collection[1]
        },
        meta: { granuleId: response.granuleId },
        payload: {
          granules: [{
            granuleId: response.granuleId,
            files: response.files
          }]
        }
      });

      await partialRecordUpdate(
        null,
        response.granuleId,
        'granule',
        { status: 'running' },
        response.collectionId
      );
      await invoke(process.env.invoke, payload);
      return {
        granuleId: response.granuleId,
        action,
        status: 'SUCCESS'
      };
    }
    else if (action === 'removeFromCmr') {

    }

    throw new Error('Action is not supported. Choices are: \'reprocess\' and \'removeFromCmr\'');
  }

  throw new Error('Action is missing');
}


/**
 * Query a single granule.
 * @param {object} event aws lambda event object.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const granuleId = _get(event.pathParameters, 'granuleName');

  const search = new Search({}, 'granule');
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
      put(event).then(r => cb(null, r)).catch(e => cb(e));
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;

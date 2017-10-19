/* eslint-disable no-param-reassign */
'use strict';

const _get = require('lodash.get');
const { S3 } = require('@cumulus/ingest/aws');
const handle = require('../lib/response').handle;

/**
 * List all providers.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const key = `${process.env.stackName}/workflows/list.json`;
  S3.get(process.env.bucket, key).then(file => {
    const workflows = JSON.parse(file.Body.toString());
    return cb(null, workflows);
  }).catch(e => cb(e));
}

/**
 * Query a single provider.
 * @param {object} event aws lambda event object.
 * @param {string} granuleId the id of the granule.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');

  const key = `${process.env.stackName}/workflows/list.json`;
  S3.get(process.env.bucket, key).then(file => {
    const workflows = JSON.parse(file.Body.toString());
    for (const w of workflows) {
      if (w.name === name) {
        return cb(null, w);
      }
    }
    return cb({ message: `A record already exists for ${name}` });
  }).catch(e => cb(e));
}

function handler(event, context) {
  handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      get(event, cb);
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;

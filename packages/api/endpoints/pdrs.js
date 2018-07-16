'use strict';

const _get = require('lodash.get');
const aws = require('@cumulus/common/aws');
const { inTestMode } = require('@cumulus/common/test-utils');
const handle = require('../lib/response').handle;
const Search = require('../es/search').Search;
const models = require('../models');

/**
 * List and search pdrs
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function list(event, cb) {
  const search = new Search(event, 'pdr');
  return search.query().then((response) => cb(null, response)).catch((e) => {
    cb(e);
  });
}

/**
 * get a single PDR
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function get(event, cb) {
  const pdrName = _get(event.pathParameters, 'pdrName');

  const p = new models.Pdr();

  return p.get({ pdrName }).then((response) => {
    cb(null, response);
  }).catch(cb);
}

/**
 * delete a given PDR
 *
 * @param {Object} event - aws lambda event object.
 * @returns {Promise<Object>} the response object
 */
async function del(event) {
  const pdrName = _get(event.pathParameters, 'pdrName');

  const p = new models.Pdr();

  // get the record first to make sure it exists
  await p.get({ pdrName });

  // remove file from s3
  const key = `${process.env.stackName}/pdrs/${pdrName}`;
  await aws.deleteS3Object(process.env.internal, key);

  await p.delete({ pdrName });

  return { detail: 'Record deleted' };
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 * @param {Object} context - aws context object
 * @returns {undefined} undefined
 */
function handler(event, context) {
  return handle(event, context, !inTestMode() /* authCheck */, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      return get(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      return del(event).then((r) => cb(null, r)).catch((e) => cb(e));
    }

    return list(event, cb);
  });
}

module.exports = {
  handler,
  get
};


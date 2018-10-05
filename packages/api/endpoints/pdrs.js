'use strict';

const aws = require('@cumulus/common/aws');
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
  const pdrName = event.pathParameters.pdrName;

  const pdrModel = new models.Pdr();

  return pdrModel.get({ pdrName }).then((response) => {
    cb(null, response);
  }).catch(cb);
}

const isRecordDoesNotExistError = (e) => e.message.includes('RecordDoesNotExist');

/**
 * delete a given PDR
 *
 * @param {Object} event - aws lambda event object.
 * @returns {Promise<Object>} the response object
 */
async function del(event) {
  const pdrName = event.pathParameters.pdrName;

  const pdrS3Key = `${process.env.stackName}/pdrs/${pdrName}`;

  await aws.deleteS3Object(process.env.internal, pdrS3Key);

  const pdrModel = new models.Pdr();

  try {
    await pdrModel.delete({ pdrName });
  }
  catch (err) {
    if (!isRecordDoesNotExistError(err)) throw err;
  }

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
  return handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      return get(event, cb);
    }
    if (event.httpMethod === 'DELETE' && event.pathParameters) {
      return del(event).then((r) => cb(null, r)).catch((e) => cb(e));
    }

    return list(event, cb);
  });
}

module.exports = handler;

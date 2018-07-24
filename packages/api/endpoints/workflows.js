'use strict';

const _get = require('lodash.get');
const { getS3Object } = require('@cumulus/common/aws');
const handle = require('../lib/response').handle;

/**
 * List all providers.
 *
 * @param {Object} event - aws lambda event object.
 * @param {callback} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function list(event, cb) {
  const key = `${process.env.stackName}/workflows/list.json`;
  getS3Object(process.env.bucket, key).then((file) => {
    const workflows = JSON.parse(file.Body.toString());
    return cb(null, workflows);
  }).catch((e) => cb(e));
}

/**
 * Query a single provider.
 *
 * @param {Object} event - aws lambda event object.
 * @param {callback} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');

  const key = `${process.env.stackName}/workflows/list.json`;
  getS3Object(process.env.bucket, key)
    .then((file) => {
      const workflows = JSON.parse(file.Body.toString());

      const matchingWorkflow = workflows.find((workflow) => workflow.name === name);
      if (matchingWorkflow) return cb(null, matchingWorkflow);

      return cb({ message: `A record already exists for ${name}` });
    })
    .catch(cb);
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 * @param {Object} context - aws context object
 * @returns {undefined} undefined
 */
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

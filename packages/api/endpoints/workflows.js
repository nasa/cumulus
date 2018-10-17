'use strict';

const _get = require('lodash.get');
const aws = require('@cumulus/common/aws');
const handle = require('../lib/response').handle;

/**
 * List all providers.
 *
 * @param {Object} event - aws lambda event object.
 * @param {callback} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
async function list(event, cb) {
  const workflowsListKey = `${process.env.stackName}/workflows/list.json`;

  try {
    const { Body } = await aws.getS3Object(process.env.bucket, workflowsListKey);
    return cb(null, Body.toString());
  }
  catch (err) {
    return cb(err);
  }
}

/**
 * Query a single provider.
 *
 * @param {Object} event - aws lambda event object.
 * @param {callback} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
async function get(event, cb) {
  const name = _get(event.pathParameters, 'name');

  const workflowKey = `${process.env.stackName}/workflows/list.json`;
  try {
    const { Body } = await aws.getS3Object(process.env.bucket, workflowKey);

    const jsonResponse = JSON.parse(Body);

    const matchingWorkflow = jsonResponse.find((workflow) => workflow.name === name);
    if (matchingWorkflow) return cb(null, matchingWorkflow);

    const e = new Error('The specified key does not exist.');
    e.name = 'NoSuchKey';
    throw e;
  }
  catch (err) {
    if (err.name === 'NoSuchKey') {
      return cb(err, null, 404);
    }
    return cb(err, null, 500);
  }
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

'use strict';

const _get = require('lodash.get');
const aws = require('@cumulus/common/aws');
const { S3 } = require('@cumulus/ingest/aws');
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
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');

  const key = `${process.env.stackName}/workflows/list.json`;
  S3.get(process.env.bucket, key)
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

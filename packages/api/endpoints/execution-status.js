'use strict';

const _get = require('lodash.get');
const handle = require('../lib/response').handle;
const { StepFunction } = require('@cumulus/ingest/aws');

/**
*  Get the status of an execution
 */
function get(event, cb) {
  const arn = _get(event.pathParameters, 'arn');

  StepFunction.getExecutionStatus(arn)
    .then((status) => cb(null, status))
    .catch(cb)
}

function handler(event, context) {
  handle(event, context, true, (cb) => {
    get(event, cb)
  });
}

module.exports = handler;

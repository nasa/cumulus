'use strict';

const _get = require('lodash.get');
const handle = require('../lib/response').handle;
const { getSfnExecutionStatusFromArn } = require('@cumulus/common/aws');

/**
 * get a single execution status
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function get(event, cb) {
  const arn = _get(event.pathParameters, 'arn');

  return getSfnExecutionStatusFromArn(arn)
    .then((status) => cb(null, status))
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
  return handle(event, context, true, (cb) => get(event, cb));
}

module.exports = handler;

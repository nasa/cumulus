/* eslint no-console: "off" */

'use strict';

/**
 * sample lambda function
 *
 * @param {Object} event - an AWS event data
 * @param {Object} context - an AWS Lambda context
 * @param {Function} cb - an AWS Lambda handler
 * @returns {Object} - return from callback
 */
function handler(event, context, cb) {
  console.log('sample lambda fuction that does nothing');
  return cb();
}

module.exports.handler = handler;

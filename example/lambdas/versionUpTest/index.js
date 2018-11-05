'use strict';

/**
 * calls callback with static key/text payload object.  Used for testing lambda modification.
 * @param {Object} event - AWS event
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */

function handler(event, context, callback) {
  const returnEvent = event;
  returnEvent.payload = { output: 'Current Version' };
  callback(null, event);
}

exports.handler = handler;
//Thu Oct 11 2018 10:24:57 GMT-0400 (EDT)

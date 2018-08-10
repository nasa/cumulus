'use strict';

/**
 * calls callback with static key/text payload object.  Used for testing lambda modification.
 * @param {Object} event - AWS event
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */

function handler(event, context, callback) {
  const eventCopy = event;
  eventCopy.payload = { output: 'Current Version' };
  callback(null, event);
}

exports.handler = handler;

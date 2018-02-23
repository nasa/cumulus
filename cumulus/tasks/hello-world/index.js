'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

/* eslint-disable no-unused-vars */

/**
* Return sample 'hello world' JSON
*
* @param {Object} event - input from the message adapter
* @returns {Object} sample JSON object
*/
function helloWorld(event) {
  return { hello: 'Hello World' };
}
/**
* Lambda handler
*
* @param {Object} event - a Cumulus Message
* @param {Object} context - an AWS Lambda context
* @param {Function} callback - an AWS Lambda handler
* @returns {undefined} - does not return a value
*/
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(helloWorld, event, context, callback);
}

exports.handler = handler;
exports.helloWorld = helloWorld; // exported to support testing

'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { log } = require('@cumulus/common');

/* eslint-disable no-unused-vars */

let passOnRetry = false;

/**
 * Throw an error if hello world is configured to throw an error for
 * testing/example purposes. Set the pass on retry value to simulate
 * a task passing on a retry.
 *
 * @param {Object} event - input from the message adapter
 * @returns {undefined} none
 */
function throwErrorIfConfigured(event) {
  if (event.config.passOnRetry && passOnRetry) {
    log.debug('Detected retry');
    passOnRetry = false;
  }
  else if (event.config.fail) {
    // This if check is to avoid race conditions in the parallel tests,
    // since passOnRetry is set globally across instances of the lambda
    // Only set this variable if it specifically configured
    if (event.config.passOnRetry) {
      passOnRetry = true;
    }

    throw new Error('Step configured to force fail');
  }
}

/**
* Return sample 'hello world' JSON
*
* @param {Object} event - input from the message adapter
* @returns {Object} sample JSON object
*/
function helloWorld(event) {
  throwErrorIfConfigured(event);

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

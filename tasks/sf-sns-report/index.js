'use strict';

const get = require('lodash.get');
const { publishReportSnsMessages } = require('@cumulus/api/lambdas/publish-reports');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

/**
 * Publishes incoming Cumulus Message in its entirety to
 * a given SNS topic
 *
 * @param  {Object} event - a Cumulus Message that has been sent through the
 * Cumulus Message Adapter. See schemas/input.json for detailed input schema.
 * @param {Object} event.config - configuration object for the task
 * @param {Object} event.config.sfnEnd - indicate if it's the last step of the step function
 * @returns {Promise.<Object>} - AWS SNS response or error in case of step function
 *  failure.
 */
async function publishSnsMessage(event) {
  const message = get(event, 'input');

  // Always assume that this step occurs in the middle of a workflow,
  // not at the beginning or the end.
  await publishReportSnsMessages(message, false, false);

  return get(message, 'payload', {});
}

exports.publishSnsMessage = publishSnsMessage;

/**
 * Lambda handler. It broadcasts an incoming Cumulus message to SNS
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context object
 * @param {Function} callback - an AWS Lambda call back
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(publishSnsMessage, event, context, callback);
}
exports.handler = handler;

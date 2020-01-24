'use strict';

const get = require('lodash.get');
const { publishReportSnsMessages } = require('@cumulus/api/lambdas/publish-reports');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

/**
 * Publishes ingest notifications based on the Cumulus execution message.
 *
 * @param  {Object} event - a Cumulus execution message that has been sent through the
 * Cumulus Message Adapter.
 * @returns {Promise<Object>} - Payload object from the Cumulus message
 */
async function publishSnsMessage(event) {
  const meta = get(event, 'input.meta', {});

  const message = {
    ...event.input,
    meta: {
      ...meta,
      status: 'running'
    }
  };

  await publishReportSnsMessages(message);

  return get(message, 'payload', {});
}

exports.publishSnsMessage = publishSnsMessage;

/**
 * Lambda handler.
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context object
 * @param {Function} callback - an AWS Lambda callback
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(publishSnsMessage, event, context, callback);
}

exports.handler = handler;

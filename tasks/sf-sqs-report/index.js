'use strict';

const get = require('lodash.get');
const { sendSQSMessage } = require('@cumulus/aws-client/SQS');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

/**
 * Publishes ingest notifications based on the Cumulus execution message.
 *
 * @param  {Object} event - a Cumulus execution message that has been sent through the
 * Cumulus Message Adapter.
 * @returns {Promise<Object>} - Payload object from the Cumulus message
 */
async function reportSQSMessage(event) {
  const meta = get(event, 'input.meta', {});

  const message = {
    ...event.input,
    meta: {
      ...meta,
      status: 'running'
    }
  };

  const sqsEvent = {
    detail: {
      input: JSON.stringify(message),
      status: 'RUNNING',
      stopDate: null
    }
  };

  const reportingQueueUrl = get(event, 'input.meta.queues.reporting', process.env.reporting_queue_url);
  if (!reportingQueueUrl) throw new Error('Reporting queue is not specified in meta.queues, nor in process.env');

  await sendSQSMessage(reportingQueueUrl, sqsEvent);

  return get(message, 'payload', {});
}

exports.reportSQSMessage = reportSQSMessage;

/**
 * Lambda handler.
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context object
 * @param {Function} callback - an AWS Lambda callback
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(reportSQSMessage, event, context, callback);
}

exports.handler = handler;

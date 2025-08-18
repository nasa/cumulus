'use strict';

const get = require('lodash/get');
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
      status: 'running',
      reportMessageSource: 'lambda',
    },
  };

  const sqsEvent = {
    detail: {
      input: JSON.stringify(message),
      status: 'RUNNING',
      stopDate: null,
    },
  };

  const reportingQueueUrl = process.env.reporting_queue_url;
  if (!reportingQueueUrl) throw new Error('Reporting queue is not specified in process.env');

  await sendSQSMessage(reportingQueueUrl, sqsEvent);

  return get(message, 'payload', {});
}

exports.reportSQSMessage = reportSQSMessage;

/**
 * Lambda handler.
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context object
 * @returns {Promise<Object>} - Returns payload object from the Cumulus message
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(reportSQSMessage, event, context);
}

exports.handler = handler;

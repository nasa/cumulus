'use strict';

const uuidv4 = require('uuid/v4');
const { sfn } = require('@cumulus/common/aws');
const { Consumer } = require('@cumulus/ingest/consumer');

/**
 * Starts a new stepfunction with the given payload
 *
 * @param {Object} message - incoming queue message
 * @returns {Promise} - AWS SF Start Execution response
 */
function dispatch(message) {
  const input = Object.assign({}, message.Body);

  input.cumulus_meta.workflow_start_time = Date.now();

  if (!input.cumulus_meta.execution_name) {
    input.cumulus_meta.execution_name = uuidv4();
  }

  return sfn().startExecution({
    stateMachineArn: message.Body.cumulus_meta.state_machine,
    input: JSON.stringify(input),
    name: input.cumulus_meta.execution_name
  }).promise();
}

/**
 * This is an SQS Queue consumer.
 *
 * It reads messages from a given sqs queue based on the configuration provided
 * in the event object
 *
 * The default is to read 1 message from a given queueUrl and quit after 240
 * seconds
 *
 * @param {Object} event - lambda input message
 * @param {string} event.queueUrl - AWS SQS url
 * @param {string} event.messageLimit - number of messages to read from SQS for
 *   this execution (default 1)
 * @param {string} event.timeLimit - how many seconds the lambda function will
 *   remain active and query the queue (default 240 s)
 * @param {Object} _context - lambda context
 * @param {function} cb - lambda callback
 * @returns {undefined} - undefined
 */
function handler(event, _context, cb) {
  const messageLimit = event.messageLimit || 1;
  const timeLimit = event.timeLimit || 240;

  if (event.queueUrl) {
    const con = new Consumer(event.queueUrl, messageLimit, timeLimit);
    con.consume(dispatch)
      .then((r) => cb(null, r))
      .catch(cb);
  } else cb(new Error('queueUrl is missing'));
}
module.exports = { handler };

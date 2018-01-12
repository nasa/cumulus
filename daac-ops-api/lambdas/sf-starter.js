/* eslint-disable require-yield, no-param-reassign */
'use strict';

const get = require('lodash.get');
const AWS = require('aws-sdk');
const consumer = require('@cumulus/ingest/consumer');

/**
 * Starts a new stepfunction witht the given payload
 *
 * @param  {string} arn Step Function's arn
 * @param  {string} name name for the Step Function's execution
 * @param  {object} payload Execution's Payload
 * @return {Promise} AWS response
 */
function dispatch(arn, name, payload) {
  // add creation time
  payload.cumulus_meta.createdAt = Date.now();

  const stepfunctions = new AWS.StepFunctions();
  const params = {
    stateMachineArn: arn,
    input: JSON.stringify(payload)
  };

  if (payload.cumulus_meta.execution_name) {
    params.name = name;
  }

  return stepfunctions.startExecution(params).promise();
}

/**
 * Extract relevant data from the incoming queue message
 * and pass it to the dispatch function
 *
 * @param  {object} message incoming queue message
 * @return {Promise}
 */
function prepareDispatch(message) {
  return dispatch(
    message.Body.cumulus_meta.state_machine,
    message.Body.cumulus_meta.execution_name,
    message.Body
  );
}

/**
 * This is a sqs Queue consumer.
 * It reads messages from a given sqs queue based on
 * the configuration provided in the event object
 *
 * The default is to read 1 message from a given queueUrl
 * and quit after 120 seconds
 *
 * @param  {object} event   lambda input message
 * @param  {string} event.queueUrl AWS SQS url
 * @param  {string} event.messageLimit number of messages to read from
 *     SQS on each query (default 1)
 * @param  {string} event.timeLimit how many seconds the lambda
 *     function will remain active and query the queue (defatul 120 s)
 * @param  {object} context lambda context
 * @param  {function} cb    lambda callback
 */
function handler(event, context, cb) {
  const queueUrl = get(event, 'queueUrl', null);
  const messageLimit = get(event, 'messageLimit', 1);
  const timeLimit = get(event, 'timeLimit', 120);

  if (queueUrl) {
    const con = new consumer.Consume(queueUrl, messageLimit, timeLimit);
    con.read(prepareDispatch).then(r => cb(null, r)).catch(e => cb(e));
  }
  else {
    cb(new Error('queueUrl is missing'));
  }
}

module.exports = handler;

'use strict';

const _get = require('lodash.get');
const handle = require('../lib/response').handle;
const { S3, StepFunction } = require('@cumulus/ingest/aws');
const { inTestMode } = require('@cumulus/common/test-utils');

async function fetchRemote(eventMessage) {
  if (eventMessage.replace) {
    const file = await S3.get(eventMessage.replace.Bucket, eventMessage.replace.Key);
    return file.Body.toString();
  }

  return eventMessage;
}

async function getEventDetails(event) {
  let result = Object.assign({}, event);
  let prop;

  if (event.type.endsWith('StateEntered')) {
    prop = 'stateEnteredEventDetails';
  }
  else if (event.type.endsWith('StateExited')) {
    prop = 'stateExitedEventDetails';
  }
  else if (event.type) {
    prop = `${event.type.charAt(0).toLowerCase() + event.type.slice(1)}EventDetails`;
  }

  if (prop && event[prop]) {
    result = Object.assign(result, event[prop]);
    delete result[prop];
  }

  if (result.input) result.input = await fetchRemote(JSON.parse(result.input));
  if (result.output) result.output = await fetchRemote(JSON.parse(result.output));

  return result;
}

/**
 * get a single execution status
 *
 * @param {Object} event - aws lambda event object.
 * @param {Function} cb - aws lambda callback function
 * @returns {undefined} undefined
 */
function get(event, cb) {
  const arn = _get(event.pathParameters, 'arn');

  return StepFunction.getExecutionStatus(arn)
    .then(async (status) => {
      // if execution output is stored remotely, fetch it from S3 and replace it
      const executionOutput = status.execution.output;

      /* eslint-disable no-param-reassign */
      if (executionOutput) status.execution.output = await fetchRemote(status.execution.output);
      /* eslint-enable no-param-reassign */

      const updatedEvents = [];
      for (let i = 0; i < status.executionHistory.events.length; i += 1) {
        const sfEvent = status.executionHistory.events[i];
        updatedEvents.push(getEventDetails(sfEvent));
      }
      /* eslint-disable no-param-reassign */
      status.executionHistory.events = await Promise.all(updatedEvents);
      /* eslint-enable no-param-reassign */
      cb(null, status);
    })
    .catch(cb);
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 * @param {Object} context - aws context object
 * @returns {undefined} undefined
 */
function handler(event, context) {
  return handle(event, context, !inTestMode() /* authCheck */, (cb) => get(event, cb));
}

module.exports = handler;


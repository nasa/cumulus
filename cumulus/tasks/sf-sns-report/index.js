'use strict';

const get = require('lodash.get');
const { StepFunction } = require('@cumulus/ingest/aws');
const { setGranuleStatus, sns } = require('@cumulus/common/aws');
const errors = require('@cumulus/common/errors');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

/**
 * Determines if there was a valid exception in the input message
 *
 * @param {Object} event - aws event object
 * @returns {boolean} true if there was an exception, false otherwise
 */
function eventFailed(event) {
  // event has exception
  // and it is needed to avoid flagging cases like "exception: {}" or "exception: 'none'"
  if (event.exception && (typeof event.exception === 'object') &&
    (Object.keys(event.exception).length > 0)) {
    return true;
  }
  // Error and error keys are not part of the cumulus message
  // and if they appear in the message something is seriously wrong
  else if (event.Error || event.error) {
    return true;
  }
  return false;
}

/**
 * if the cumulus message shows that a previous step failed,
 * this function extracts the error message from the cumulus message
 * and fails the function with that information. This ensures that the
 * Step Function workflow fails with the correct error info
 *
 * @param {Object} event - aws event object
 * @returns {undefined} throws an error and does not return anything
 */
function makeLambdaFunctionFail(event) {
  const error = get(event, 'exception.Error', get(event, 'error.Error'));
  const cause = get(event, 'exception.Cause', get(event, 'error.Cause'));
  if (error) {
    if (errors[error]) {
      throw new errors[error](cause);
    }
    else if (error === 'TypeError') {
      throw new TypeError(cause);
    }
    throw new Error(cause);
  }

  throw new Error('Step Function failed for an unknown reason.');
}

/**
 * Publishes incoming Cumulus Message in its entirety to
 * a given SNS topic
 *
 * @param  {Object} event - a Cumulus Message that has been sent through the
 * Cumulus Message Adapter. See schemas/input.json for detailed input schema.
 * @param {Object} event.config - configuration object for the task
 * @param {Object} event.config.sfnEnd - indicate if it's the last step of the step function
 * @param {string} event.config.stack - the name of the deployment stack
 * @param {string} event.config.bucket - S3 bucket
 * @param {string} event.config.stateMachine - current state machine
 * @param {string} event.config.executionTime - execution time
 * @returns {Promise.<Object>} - AWS SNS response. see schemas/output.json for detailed output
 * schema that is passed to the next task in the workflow
 */
async function publishSnsMessage(event) {
  const config = get(event, 'config', []);
  const message = get(event, 'input', []);

  const finished = get(config, 'sfnEnd', false);
  const topicArn = get(message, 'meta.topic_arn', null);
  const failed = eventFailed(message);

  if (topicArn) {
    // if this is the sns call at the end of the execution
    if (finished) {
      message.meta.status = failed ? 'failed' : 'completed';
      const granuleId = get(message, 'meta.granuleId', null);
      if (granuleId) {
        await setGranuleStatus(
          granuleId,
          get(config, 'stack', null),
          get(config, 'bucket', null),
          get(config, 'stateMachine', null),
          get(config, 'executionName', null),
          message.meta.status
        );
      }
    }
    else {
      message.meta.status = 'running';
    }

    await sns().publish({
      TopicArn: topicArn,
      Message: JSON.stringify(message)
    }).promise();
  }

  if (failed) {
    makeLambdaFunctionFail(message);
  }

  return message;
}

exports.publishSnsMessage = publishSnsMessage;

/**
 * Lambda handler. It broadcasts an incoming Cumulus message to SNS
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context object
 * @param {Function} callback - an AWS Lambda call back
 * @returns {Promise} updated event object
 */
function handler(event, context, callback) {
  return StepFunction.pullEvent(event).then((message) => {
    cumulusMessageAdapter.runCumulusTask(publishSnsMessage, message, context, callback);
  });
}
exports.handler = handler;

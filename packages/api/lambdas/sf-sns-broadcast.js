'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');
const isObject = require('lodash.isobject');
const { pullStepFunctionEvent } = require('@cumulus/common/aws');
const { setGranuleStatus } = require('@cumulus/common/aws');
const errors = require('@cumulus/common/errors');

/**
 * Determines if there was a valid exception in the input message
 *
 * @param {Object} event - aws event object
 * @returns {boolean} true if there was an exception, false otherwise
 */
function eventFailed(event) {
  if (event.exception) {
    if (isObject(event.exception)) {
      // this is needed to avoid flagging cases like "exception: {}" or "exception: 'none'"
      if (Object.keys(event.exception).length > 0) {
        return true;
      }
    }
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
 * this function extract the error message from the cumulus message
 * and fail the function with that information. This ensures that the
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
    } else if (error === 'TypeError') {
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
 * @param  {Object} message - Cumulus message
 * @param  {boolean} finished - indicates if the message belongs to the end of a stepFunction
 * @returns {Promise} AWS SNS response
 */
async function publish(message, finished = false) {
  const event = await pullStepFunctionEvent(message);

  const topicArn = get(event, 'meta.topic_arn', null);
  const failed = eventFailed(event);

  if (topicArn) {
    // if this is the sns call at the end of the execution
    if (finished) {
      if (failed) {
        event.meta.status = 'failed';
      } else {
        event.meta.status = 'completed';
      }
      const granuleId = get(event, 'meta.granuleId', null);
      if (granuleId) {
        await setGranuleStatus(
          granuleId,
          event.meta.stack,
          event.cumulus_meta.system_bucket,
          event.cumulus_meta.state_machine,
          event.cumulus_meta.execution_name,
          event.meta.status
        );
      }
    } else {
      event.meta.status = 'running';
    }

    const sns = new AWS.SNS();
    await sns.publish({
      TopicArn: topicArn,
      Message: JSON.stringify(event)
    }).promise();
  }

  if (failed) {
    makeLambdaFunctionFail(event);
  }

  return event;
}

/**
 * Handler for the Start (first) Step in the workflow. It broadcasts an incoming
 * Cumulus message to SNS
 *
 * @param {Object} event - aws lambda event object
 * @param {Object} context - aws lambda context object
 * @param {Object} cb - aws lambda callback object
 * @returns {Promise} updated event object
 */
function start(event, context, cb) {
  return publish(event).then((r) => cb(null, r)).catch((e) => cb(e));
}

/**
 * Handler for the end (final) Step in the workflow. It broadcasts an incoming
 * Cumulus message to SNS
 *
 * @param {Object} event - aws lambda event object
 * @param {Object} context - aws lambda context object
 * @param {Object} cb - aws lambda callback object
 * @returns {Promise} updated event object
 */
function end(event, context, cb) {
  return publish(event, true).then((r) => cb(null, r)).catch((e) => cb(e));
}

module.exports.start = start;
module.exports.end = end;

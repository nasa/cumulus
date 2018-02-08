'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');
const { StepFunction } = require('@cumulus/ingest/aws');
const errors = require('@cumulus/common/errors');

/**
 * Publishes incoming Cumulus Message in its entirety to
 * a given SNS topic
 *
 * @param  {Object} message - Cumulus message
 * @param  {boolean} finish - indicates if the message belongs to the end of a stepFunction
 * @returns {Promise} AWS SNS response
 */
async function publish(message, finish = false) {
  const event = await StepFunction.pullEvent(message);
  const topicArn = get(event, 'meta.topic_arn', null);
  let failed = false;

  if ((event.exception && Object.keys(event.exception).length > 0) || event.error) {
    failed = true;
    event.meta.status = 'failed';
  }
  else {
    event.meta.status = 'completed';
  }

  if (topicArn) {
    // if this is the sns call at the end of the execution
    if (finish) {
      const granuleId = get(event, 'meta.granuleId', null);
      if (granuleId) {
        await StepFunction.setGranuleStatus(granuleId, event);
      }
    }
    else {
      event.meta.status = 'running';
    }

    const sns = new AWS.SNS();
    await sns.publish({
      TopicArn: topicArn,
      Message: JSON.stringify(event)
    }).promise();
  }

  if (failed) {
    const error = get(event, 'exception.Error');
    const cause = get(event, 'exception.Cause');
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

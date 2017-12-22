'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');
const { StepFunction } = require('@cumulus/ingest/aws');
const errors = require('@cumulus/common/errors');

/**
 * Publishes incoming Cumulus Message in its entirety to
 * a given SNS topic
 *
 * @param  {object} message Cumulus message
 * @param  {boolean} finish  indicates if the message belongs to the end of a stepFunction
 * @return {Promise} AWS SNS response 
 */
async function publish(message, finish = false) {
  const event = await StepFunction.pullEvent(message);
  const topicArn = get(event, 'meta.topic_arn', null);
  let failed = false;

  if (topicArn) {
    // if this is the sns call at the end of the execution
    if (finish) {
      if (event.exception || event.error) {
        failed = true;
        event.meta.status = 'failed';
      }
      else {
        event.meta.status = 'completed';
      }

      const granuleId = get(event, 'meta.granuleId', null);
      if (granuleId) {
        await StepFunction.setGranuleStatus(granuleId, event);
      }
    }
    else {
      event.meta.status = 'running';
    }

    const sns = new AWS.SNS();
    return sns.publish({
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
  }

  return event;
}

function start(event, context, cb) {
  return publish(event).then(r => cb(null, r)).catch(e => cb(e));
}

function end(event, context, cb) {
  return publish(event, true).then(r => cb(null, r)).catch(e => cb(e));
}

module.exports.start = start;
module.exports.end = end;

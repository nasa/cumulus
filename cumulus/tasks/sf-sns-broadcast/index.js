/* eslint-disable no-param-reassign */
'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');
const { StepFunction } = require('@cumulus/ingest/aws');

async function publish(message, finish = false) {
  const event = await StepFunction.pullEvent(message);
  const topicArn = get(event, 'ingest_meta.topic_arn', null);

  if (topicArn) {
    // if this is the sns call at the end of the execution
    if (finish) {
      if (event.exception || event.error) {
        event.ingest_meta.status = 'failed';
      }
      else {
        event.ingest_meta.status = 'completed';
      }

      const granuleId = get(event, 'meta.granuleId', null);
      if (granuleId) {
        await StepFunction.setGranuleStatus(granuleId, event);
      }
    }

    const sns = new AWS.SNS();
    await sns.publish({
      TopicArn: topicArn,
      Message: JSON.stringify(message)
    }).promise();
  }

  return message;
}

function start(event, context, cb) {
  return publish(event).then(r => cb(null, r)).catch(e => cb(e));
}

function end(event, context, cb) {
  return publish(event, true).then(r => cb(null, r)).catch(e => cb(e));
}

module.exports.start = start;
module.exports.end = end;

/* eslint-disable no-param-reassign */
'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');

function publish(arn, message, cb) {
  const sns = new AWS.SNS();
  sns.publish({
    TopicArn: arn,
    Message: JSON.stringify(message)
  }, (e) => {
    if (e) return cb(e);
    return cb(message.exception, message);
  });
}

function start(event, context, cb) {
  const topicArn = get(event, 'ingest_meta.topic_arn', null);

  if (topicArn) {
    return publish(topicArn, event, cb);
  }
  return event;
}

function end(event, context, cb) {
  const topicArn = get(event, 'ingest_meta.topic_arn', null);

  if (topicArn) {
    if (event.exception) {
      event.ingest_meta.status = 'failed';
    }
    else {
      event.ingest_meta.status = 'completed';
    }
    return publish(topicArn, event, cb);
  }
  return event;
}

module.exports.start = start;
module.exports.end = end;

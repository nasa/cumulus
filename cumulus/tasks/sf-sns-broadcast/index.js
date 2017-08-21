'use strict';

const AWS = require('aws-sdk');
const get = require('lodash.get');

function handler(event, context, cb) {
  const topicArn = get(event, 'ingest_meta.topic_arn', null);

  if (topicArn) {
    const sns = new AWS.SNS();
    return sns.publish({
      TopicArn: topicArn,
      Message: JSON.stringify(event)
    }, (e) => {
      if (e) return cb(e);

      return cb(null, event);
    });
  }
  return event;
}

module.exports.handler = handler;

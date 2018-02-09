'use strict';

const get = require('lodash.get');
const aws = require('@cumulus/ingest/aws');
const uuidv4 = require('uuid/v4');

function handler(event, context, cb) {
  const { bucket, key } = aws.S3.parseS3Uri(event.template);

  return aws.S3.get(bucket, key)
    .then((data) => {
      const message = JSON.parse(data.Body);
      message.provider = event.provider || {};
      message.meta = event.meta || {};
      message.payload = event.payload || {};
      message.cumulus_meta.execution_name = uuidv4();

      if (event.collection) {
        message.collection = {
          id: event.collection.name,
          meta: event.collection
        };
      }

      return aws.SQS.sendMessage(message.resources.queues.startSF, message)
        .then((r) => cb(null, r));
    })
    .catch(cb);
}
module.exports = handler;

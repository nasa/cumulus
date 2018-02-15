'use strict';

const get = require('lodash.get');
const aws = require('@cumulus/ingest/aws');
const uuidv4 = require('uuid/v4');

function handler(event, context, cb) {
  const template = get(event, 'template');
  const provider = get(event, 'provider', {});
  const meta = get(event, 'meta', {});
  const collection = get(event, 'collection', {});
  const payload = get(event, 'payload', {});

  const parsed = aws.S3.parseS3Uri(template);
  aws.S3.get(parsed.Bucket, parsed.Key).then((data) => {
    const message = JSON.parse(data.Body);
    message.provider = provider;
    message.meta = meta;
    message.payload = payload;
    message.cumulus_meta.execution_name = uuidv4();

    if (collection) {
      message.collection = {
        id: collection.name,
        meta: collection
      };
    }

    return aws.SQS.sendMessage(message.resources.queues.startSF, message)
        .then((r) => cb(null, r));
  })
  .catch(cb);
}
module.exports = handler;

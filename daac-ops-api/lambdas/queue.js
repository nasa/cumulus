/* eslint-disable require-yield */
'use strict';

const get = require('lodash.get');
const randomstring = require('randomstring');
const aws = require('@cumulus/ingest/aws');

function generateRandomName() {
  const r = [];
  for (let i = 0; i < 5; i++) {
    r.push(randomstring.generate(7));
  }

  return r.join('-');
}

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

    if (collection) {
      message.collection = {
        id: collection.name,
        meta: collection
      };
    }
    message.ingest_meta.execution_name = generateRandomName();

    aws.SQS.sendMessage(message.resources.queues.startSF, message)
       .then(r => cb(null, r))
      .catch(e => cb(e));
  }).catch(e => cb(e));
}

module.exports = handler;

'use strict';

const get = require('lodash.get');
const cryptoRandomString = require('crypto-random-string');
const { S3, SQS } = require('@cumulus/ingest/aws');
const { Provider, Collection } = require('../models');

function schedule(event, context, cb) {
  const template = get(event, 'template');
  const provider = get(event, 'provider', null);
  const meta = get(event, 'meta', {});
  const collection = get(event, 'collection', null);
  const payload = get(event, 'payload', {});
  let message;

  const parsed = S3.parseS3Uri(template);
  S3.get(parsed.Bucket, parsed.Key)
    .then((data) => {
      message = JSON.parse(data.Body);
      message.provider = {};
      message.collection = {};
      message.meta = meta;
      message.payload = payload;
      message.ingest_meta.execution_name = cryptoRandomString(25);

      return;
    })
    .then(() => {
      if (provider) {
        const p = new Provider();
        return p.get({ id: provider });
      }
      return null;
    })
    .then((p) => {
      if (p) {
        message.provider = p;
      }

      if (collection) {
        const c = new Collection();
        return c.get({ name: collection.name, version: collection.version });
      }
      return null;
    })
    .then((c) => {
      if (c) {
        message.collection = {
          id: c.name,
          meta: c
        };
      }
      return null;
    })
    .then(() => SQS.sendMessage(message.resources.queues.startSF, message))
    .then(r => cb(null, r))
    .catch(e => cb(e));
}

module.exports = schedule;

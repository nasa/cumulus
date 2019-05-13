'use strict';

const get = require('lodash.get');
const merge = require('lodash.merge');
const uuidv4 = require('uuid/v4');
const { getS3Object, parseS3Uri } = require('@cumulus/common/aws');
const { SQS } = require('@cumulus/ingest/aws');
const { Provider, Collection } = require('../models');

/**
 * Builds a cumulus-compatible message and adds it to the startSF queue
 * startSF queue will then start a stepfunction for the given message
 *
 * @param   {Object} event   - lambda input message
 * @param   {Object} context - lambda context
 * @param   {function} cb    - lambda callback
 */
function schedule(event, context, cb) {
  const template = get(event, 'template');
  const provider = get(event, 'provider', null);
  const meta = get(event, 'meta', {});
  const cumulusMeta = get(event, 'cumulus_meta', {});
  const collection = get(event, 'collection', null);
  const payload = get(event, 'payload', {});
  let message;

  const parsed = parseS3Uri(template);
  getS3Object(parsed.Bucket, parsed.Key)
    .then((data) => {
      message = JSON.parse(data.Body);
      message.meta.provider = {};
      message.meta.collection = {};
      message.meta = merge(message.meta, meta);
      message.payload = payload;
      message.cumulus_meta.execution_name = uuidv4();
      message.cumulus_meta = merge(message.cumulus_meta, cumulusMeta);
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
        message.meta.provider = p;
      }

      if (collection) {
        const c = new Collection();
        return c.get({ name: collection.name, version: collection.version });
      }
      return null;
    })
    .then((c) => {
      if (c) message.meta.collection = c;
    })
    .then(() => {
      SQS.sendMessage(message.meta.queues.startSF, message);
    })
    .then((r) => cb(null, r))
    .catch((e) => cb(e));
}

module.exports = { schedule };

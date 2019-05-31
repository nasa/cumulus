'use strict';

const get = require('lodash.get');
const merge = require('lodash.merge');
const uuidv4 = require('uuid/v4');
const { getS3Object, parseS3Uri } = require('@cumulus/common/aws');
const { SQS } = require('@cumulus/ingest/aws');
const { Provider, Collection } = require('../models');

const buildCumulusMeta = (queueName) => ({
  execution_name: uuidv4(),
  queueName
});

function getProvider(provider) {
  if (provider) {
    const p = new Provider();
    return p.get({ id: provider });
  }
  return {};
}

function getCollection(collection) {
  if (collection) {
    const c = new Collection();
    return c.get({ name: collection.name, version: collection.version });
  }
  return {};
}

function buildMessage(event, baseMessage) {
  const provider = get(event, 'provider', null);
  const meta = get(event, 'meta', {});
  const cumulusMeta = get(event, 'cumulus_meta', {});
  const collection = get(event, 'collection', null);
  const payload = get(event, 'payload', {});
  const queueName = get(event, 'queueName', 'startSF');

  return {
    ...baseMessage,
    provider: getProvider(provider),
    collection: getCollection(collection),
    meta: merge(baseMessage.meta, meta),
    payload,
    cumulus_meta: merge(buildCumulusMeta(queueName), cumulusMeta)
  };
}

/**
 * Builds a cumulus-compatible message and adds it to the queue specified
 * by meta.queueName. This queue will then start a stepfunction for the
 * given message
 *
 * @param {Object} event   - lambda input message
 */
async function schedule(event) {
  const template = get(event, 'template');

  const parsed = parseS3Uri(template);
  const data = await getS3Object(parsed.Bucket, parsed.Key);

  const message = buildMessage(event, JSON.parse(data.Body));

  const queueName = message.cumulus_meta.queueName;
  await SQS.sendMessage(message.meta.queues[queueName], message);
}

module.exports = { schedule };

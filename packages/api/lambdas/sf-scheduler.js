'use strict';

const get = require('lodash.get');
const merge = require('lodash.merge');
const uuidv4 = require('uuid/v4');
const { getMessageFromTemplate } = requrie('@cumulus/ingest/queue');
const { SQS } = require('@cumulus/ingest/aws');
const { Provider, Collection } = require('../models');

const buildCumulusMeta = (queueName) => ({
  execution_name: uuidv4(),
  queueName
});

function getProvider(providerId) {
  if (providerId) {
    const p = new Provider();
    return p.get({ id: providerId });
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
    cumulus_meta: merge(cumulusMeta, buildCumulusMeta(queueName))
  };
}

/**
 * Add a Cumulus workflow message to the queue specified by event.queueName.
 * 
 * A consumer should be configured for this queue to start executions for
 * the queued message.
 *
 * @param {Object} event - lambda input message
 */
async function schedule(event) {
  const template = get(event, 'template');

  const data = getMessageFromTemplate(template);
  const message = buildMessage(event, data);

  const queueName = message.cumulus_meta.queueName;
  await SQS.sendMessage(message.meta.queues[queueName], message);
}

module.exports = { schedule };

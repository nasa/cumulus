'use strict';

const get = require('lodash.get');
const merge = require('lodash.merge');
const uuidv4 = require('uuid/v4');
const { getMessageFromTemplate } = require('@cumulus/ingest/queue');
const { SQS } = require('@cumulus/ingest/aws');
const { Provider, Collection } = require('../models');

const buildCumulusMeta = (queueName) => ({
  execution_name: uuidv4(),
  queueName
});

async function getProvider(providerId) {
  if (providerId) {
    const p = new Provider();
    return p.get({ id: providerId });
  }
  return undefined;
}

async function getCollection(collection) {
  if (collection) {
    const c = new Collection();
    return c.get({ name: collection.name, version: collection.version });
  }
  return undefined;
}

async function buildMessage(event, messageTemplate) {
  const provider = get(event, 'provider', null);
  const meta = get(event, 'meta', {});
  const cumulusMeta = get(event, 'cumulus_meta', {});
  const collection = get(event, 'collection', null);
  const payload = get(event, 'payload', {});
  const queueName = get(event, 'queueName', 'startSF');

  const defaultCollectionAndProvider = {
    provider: await getProvider(provider),
    collection: await getCollection(collection)
  };

  return {
    ...messageTemplate,
    meta: merge(messageTemplate.meta, meta, defaultCollectionAndProvider),
    payload,
    cumulus_meta: merge(messageTemplate.cumulus_meta, cumulusMeta, buildCumulusMeta(queueName))
  };
}

/**
 * Add a Cumulus workflow message to the queue specified by event.queueName.
 * A consumer should be configured for this queue to start executions for
 * the queued message.
 *
 * @param {Object} event - lambda input message
 */
async function schedule(event) {
  const templateUri = get(event, 'template');

  const messageTemplate = await getMessageFromTemplate(templateUri);
  const message = await buildMessage(event, messageTemplate);

  const queueName = message.cumulus_meta.queueName;
  await SQS.sendMessage(message.meta.queues[queueName], message);
}

module.exports = { schedule };

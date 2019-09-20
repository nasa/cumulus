'use strict';

const get = require('lodash.get');

const { buildQueueMessageFromTemplate } = require('@cumulus/common/message');
const { SQS } = require('@cumulus/ingest/aws');
const { Provider, Collection } = require('../models');

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

/**
 * Add a Cumulus workflow message to the queue specified by event.queueName.
 *
 * A consumer should be configured for this queue to start executions for
 * the queued message.
 *
 * @param {Object} event - lambda input message
 * @returns {Promise}
 */
async function handleScheduleEvent(event) {
  const collectionData = get(event, 'collection', null);
  const providerId = get(event, 'provider', null);
  const customMeta = get(event, 'meta', {});
  const customCumulusMeta = get(event, 'cumulus_meta', {});
  const payload = get(event, 'payload', {});
  const queueName = get(event, 'queueName', 'startSF');
  const messageTemplate = get(event, 'template');
  const workflowDefinition = get(event, 'definition');

  const provider = await getProvider(providerId);
  const collection = await getCollection(collectionData);
  const workflow = {
    name: workflowDefinition.name,
    arn: workflowDefinition.arn
  };

  const message = buildQueueMessageFromTemplate({
    messageTemplate,
    payload,
    queueName,
    customMeta,
    customCumulusMeta,
    collection,
    provider,
    workflow
  });

  return SQS.sendMessage(message.meta.queues[queueName], message);
}

/**
 * Handler for sf-scheduler lambda.
 *
 * @param {Object} event - lambda input message
 */
async function schedule(event) {
  return handleScheduleEvent(event);
}

module.exports = {
  handleScheduleEvent,
  schedule
};

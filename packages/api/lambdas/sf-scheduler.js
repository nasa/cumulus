'use strict';

const get = require('lodash.get');

const { buildQueueMessageFromTemplate } = require('@cumulus/common/message');
const { isNil } = require('@cumulus/common/util');
const { SQS } = require('@cumulus/ingest/aws');
const Collection = require('../models/collections');
const Provider = require('../models/providers');

const getProvider = (id) => {
  if (isNil(id)) return undefined;
  return (new Provider()).get({ id });
};

const getCollection = (collection) => {
  if (isNil(collection)) return undefined;

  const c = new Collection();
  return c.get({ name: collection.name, version: collection.version });
};

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
  const [provider, collection] = await Promise.all([
    getProvider(event.provider),
    getCollection(event.collection)
  ]);

  const messageTemplate = get(event, 'template');
  const queueName = get(event, 'queueName', 'startSF');
  const workflowDefinition = get(event, 'definition');
  const workflow = {
    name: workflowDefinition.name,
    arn: workflowDefinition.arn
  };

  const message = buildQueueMessageFromTemplate({
    collection,
    messageTemplate,
    provider,
    queueName,
    asyncOperationId: get(event, 'asyncOperationId'),
    customCumulusMeta: get(event, 'cumulus_meta', {}),
    customMeta: get(event, 'meta', {}),
    payload: get(event, 'payload', {}),
    workflow
  });

  return SQS.sendMessage(message.meta.queues[queueName], message);
}

module.exports = {
  handleScheduleEvent,
  schedule: handleScheduleEvent // ¯\_(ツ)_/¯
};

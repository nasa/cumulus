'use strict';

const get = require('lodash/get');

const SQS = require('@cumulus/aws-client/SQS');
const { buildQueueMessageFromTemplate } = require('@cumulus/message/Build');
const { isNil } = require('@cumulus/common/util');
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
 * Add a Cumulus workflow message to the queue specified by event.queueUrl.
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
  const queueUrl = get(event, 'queueUrl', process.env.defaultSchedulerQueueUrl);
  const workflowDefinition = get(event, 'definition');
  const workflow = {
    name: workflowDefinition.name,
    arn: workflowDefinition.arn
  };

  const eventCustomMeta = get(event, 'meta', {});

  const message = buildQueueMessageFromTemplate({
    messageTemplate,
    queueUrl,
    asyncOperationId: get(event, 'asyncOperationId'),
    customCumulusMeta: get(event, 'cumulus_meta', {}),
    customMeta: {
      ...eventCustomMeta,
      collection,
      provider
    },
    payload: get(event, 'payload', {}),
    workflow
  });

  return SQS.sendSQSMessage(queueUrl, message);
}

module.exports = {
  handleScheduleEvent
};

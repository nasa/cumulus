'use strict';

const get = require('lodash/get');

const SQS = require('@cumulus/aws-client/SQS');
const { getProvider } = require('@cumulus/api-client/providers');
const { buildQueueMessageFromTemplate } = require('@cumulus/message/Build');
const isNil = require('lodash/isNil');
const Collection = require('../models/collections');

const getApiProvider = (providerId) => {
  if (isNil(providerId)) return undefined;
  return getProvider({
    prefix: process.env.stackName,
    providerId,
  });
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
  const [providerRecord, collection] = await Promise.all([
    getApiProvider(event.provider),
    getCollection(event.collection),
  ]);

  const provider = JSON.parse(providerRecord.body);
  const messageTemplate = get(event, 'template');
  const queueUrl = get(event, 'queueUrl', process.env.defaultSchedulerQueueUrl);
  const workflowDefinition = get(event, 'definition');
  const workflow = {
    name: workflowDefinition.name,
    arn: workflowDefinition.arn,
  };

  const eventCustomMeta = get(event, 'meta', {});

  const message = buildQueueMessageFromTemplate({
    messageTemplate,
    asyncOperationId: get(event, 'asyncOperationId'),
    customCumulusMeta: get(event, 'cumulus_meta', {}),
    customMeta: {
      ...eventCustomMeta,
      collection,
      provider,
    },
    payload: get(event, 'payload', {}),
    workflow,
    executionNamePrefix: event.executionNamePrefix,
  });

  return SQS.sendSQSMessage(queueUrl, message);
}

module.exports = {
  handleScheduleEvent,
};

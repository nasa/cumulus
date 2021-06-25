'use strict';

const get = require('lodash/get');
const isNil = require('lodash/isNil');

const { getCollection } = require('@cumulus/api-client/collections');
const SQS = require('@cumulus/aws-client/SQS');
const { buildQueueMessageFromTemplate } = require('@cumulus/message/Build');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/api/lambdas/sf-scheduler' });
const Provider = require('../models/providers');

const getProvider = (id) => {
  if (isNil(id)) return undefined;
  return (new Provider()).get({ id });
};

const getApiCollection = (collection) => {
  logger.debug(`Getting collection from API that matches ${JSON.stringify(collection)}`);
  if (isNil(collection)) return undefined;
  return getCollection({
    prefix: process.env.stackName,
    collectionName: collection.name,
    collectionVersion: collection.version,
  });
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
    getApiCollection(event.collection),
  ]);

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

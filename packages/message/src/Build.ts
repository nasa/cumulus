'use strict';

/**
 * Utility functions for building Cumulus messages
 *
 * @module Build
 *
 * @example
 * const Build = require('@cumulus/message/Build');
 */

import merge from 'lodash/merge';
import { Message } from '@cumulus/types';
import { v4 as uuidv4 } from 'uuid';

import {
  MessageTemplate,
  QueueMessageMeta,
  Workflow
} from './types';

/**
 * Generate an execution name.
 *
 * @returns {string}
 * @private
 */
const createExecutionName = () => uuidv4();

/**
 * Build base message.cumulus_meta for a queued execution.
 *
 * @param {Object} params
 * @param {string} [params.queueName] - An SQS queue name
 * @param {string} params.stateMachine - State machine name
 * @param {string} [params.asyncOperationId] - Async operation ID
 * @param {string} [params.parentExecutionArn] - Parent execution ARN
 * @returns {CumulusMeta}
 *
 * @private
 */
export const buildCumulusMeta = ({
  queueName,
  stateMachine,
  asyncOperationId,
  parentExecutionArn
}: {
  queueName?: string
  stateMachine: string,
  asyncOperationId?: string,
  parentExecutionArn?: string
}) => {
  const cumulusMeta: Message.CumulusMeta = {
    execution_name: createExecutionName(),
    queueName,
    state_machine: stateMachine
  };
  if (parentExecutionArn) cumulusMeta.parentExecutionArn = parentExecutionArn;
  if (asyncOperationId) cumulusMeta.asyncOperationId = asyncOperationId;
  return cumulusMeta;
};

/**
 * Build base message.meta for a queued execution.
 *
 * @param {Object} params
 * @param {string} params.workflowName - Workflow name
 * @param {Object} [params.collection] - A collection object
 * @param {Object} [params.provider] - A provider object
 * @returns {Meta}
 *
 * @private
 */
const buildMeta = ({
  workflowName,
  collection,
  provider
}: {
  workflowName: string
  collection?: object
  provider?: object
}) => {
  const meta: QueueMessageMeta = {
    workflow_name: workflowName
  };
  if (collection) {
    meta.collection = collection;
  }
  if (provider) {
    meta.provider = provider;
  }
  return meta;
};

/**
 * Build an SQS message from a workflow template for queueing executions.
 *
 * @param {Object} params
 * @param {Object} params.provider - A provider object
 * @param {Object} params.collection - A collection object
 * @param {string} params.parentExecutionArn - ARN for parent execution
 * @param {Object} params.messageTemplate - Message template for the workflow
 * @param {Object} params.payload - Payload for the workflow
 * @param {Object} params.workflow - workflow name & arn object
 * @param {string} [params.queueName] - SQS queue name
 * @param {string} [params.asyncOperationId] - Async operation ID
 * @param {Object} [params.customCumulusMeta] - Custom data for message.cumulus_meta
 * @param {Object} [params.customMeta] - Custom data for message.meta
 *
 * @returns {CumulusMessage} A Cumulus message object
 *
 * @alias module:Build
 */
export const buildQueueMessageFromTemplate = ({
  provider,
  collection,
  parentExecutionArn,
  queueName,
  asyncOperationId,
  messageTemplate,
  payload,
  workflow,
  customCumulusMeta = {},
  customMeta = {}
}: {
  provider: object,
  collection: object
  parentExecutionArn: string,
  messageTemplate: MessageTemplate,
  payload: object
  workflow: Workflow,
  queueName?: string,
  asyncOperationId?: string,
  customCumulusMeta?: object
  customMeta?: object
}): Message.CumulusMessage => {
  const cumulusMeta = buildCumulusMeta({
    asyncOperationId,
    parentExecutionArn,
    queueName,
    stateMachine: workflow.arn
  });

  const meta = buildMeta({
    collection,
    provider,
    workflowName: workflow.name
  });

  const message = {
    ...messageTemplate,
    meta: merge(messageTemplate.meta, customMeta, meta),
    cumulus_meta: merge(messageTemplate.cumulus_meta, customCumulusMeta, cumulusMeta),
    payload
  };

  return message;
};

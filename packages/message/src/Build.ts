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
  CumulusQueueMessage,
  QueueMessageMeta,
  Workflow
} from './types';

/**
 * Generate an execution name.
 *
 * @returns {string}
 * @private
 */
const createExecutionName = (): string => uuidv4();

/**
 * Build base message.cumulus_meta for a queued execution.
 *
 * @param {Object} params
 * @param {string} [params.queueArn] - An SQS queue name
 * @param {string} params.stateMachine - State machine name
 * @param {string} [params.asyncOperationId] - Async operation ID
 * @param {string} [params.parentExecutionArn] - Parent execution ARN
 * @returns {Message.CumulusMeta}
 *
 * @private
 */
export const buildCumulusMeta = ({
  queueUrl,
  stateMachine,
  asyncOperationId,
  parentExecutionArn
}: {
  queueUrl?: string
  stateMachine: string,
  asyncOperationId?: string,
  parentExecutionArn?: string
}): Message.CumulusMeta => {
  const cumulusMeta: Message.CumulusMeta = {
    execution_name: createExecutionName(),
    queueUrl,
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
}): QueueMessageMeta => {
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
 * @param {string} [params.queueUrl] - SQS queue URL
 * @param {string} [params.asyncOperationId] - Async operation ID
 * @param {Object} [params.customCumulusMeta] - Custom data for message.cumulus_meta
 * @param {Object} [params.customMeta] - Custom data for message.meta
 *
 * @returns {CumulusQueueMessage} A Cumulus message object
 *
 * @alias module:Build
 */
export const buildQueueMessageFromTemplate = ({
  provider,
  collection,
  parentExecutionArn,
  queueUrl,
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
  queueUrl?: string,
  asyncOperationId?: string,
  customCumulusMeta?: object
  customMeta?: object
}): CumulusQueueMessage => {
  const cumulusMeta = buildCumulusMeta({
    asyncOperationId,
    parentExecutionArn,
    queueUrl,
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

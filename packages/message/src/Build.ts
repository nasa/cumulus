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
  WorkflowMessageTemplate,
  WorkflowMessageTemplateCumulusMeta,
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
 * @param {string} [params.queueUrl] - An SQS queue URL
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
  parentExecutionArn,
  templateCumulusMeta
}: {
  queueUrl: string
  stateMachine: string,
  asyncOperationId?: string,
  parentExecutionArn?: string,
  templateCumulusMeta: WorkflowMessageTemplateCumulusMeta
}): Message.CumulusMeta => {
  const cumulusMeta: Message.CumulusMeta = {
    ...templateCumulusMeta,
    execution_name: createExecutionName(),
    queueUrl,
    state_machine: stateMachine
  };
  if (parentExecutionArn) cumulusMeta.parentExecutionArn = parentExecutionArn;
  if (asyncOperationId) cumulusMeta.asyncOperationId = asyncOperationId;
  return cumulusMeta;
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
 * @returns {Message.CumulusMessage} A Cumulus message object
 *
 * @alias module:Build
 */
export const buildQueueMessageFromTemplate = ({
  parentExecutionArn,
  queueUrl,
  asyncOperationId,
  messageTemplate,
  payload,
  workflow,
  customCumulusMeta = {},
  customMeta = {}
}: {
  parentExecutionArn: string,
  messageTemplate: WorkflowMessageTemplate,
  payload: object
  workflow: Workflow,
  queueUrl: string,
  asyncOperationId?: string,
  customCumulusMeta?: object
  customMeta?: object
}): Message.CumulusMessage => {
  const cumulusMeta = buildCumulusMeta({
    asyncOperationId,
    parentExecutionArn,
    queueUrl,
    stateMachine: workflow.arn,
    templateCumulusMeta: messageTemplate.cumulus_meta
  });

  const message = {
    ...messageTemplate,
    meta: merge(messageTemplate.meta, customMeta, {
      workflow_name: workflow.name
    }),
    cumulus_meta: merge(customCumulusMeta, cumulusMeta),
    payload
  };

  return message;
};

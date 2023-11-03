'use strict';

import { Context } from 'aws-lambda';
import isObject from 'lodash/isObject';
import pick from 'lodash/pick';

import { invoke } from '@cumulus/aws-client/Lambda';
import { runCumulusTask, CumulusMessageWithAssignedPayload } from '@cumulus/cumulus-message-adapter-js';
import Logger from '@cumulus/logger';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';

import { HandlerEvent, HandlerOutput } from './types';

const log = new Logger({ sender: '@cumulus/orca-copy-to-archive-adapter' });

/**
 * Invoke orca copy-to-archive lambda
 *
 * @param {HandlerEvent} event - input from the message adapter
 * @returns {Promise<HandlerOutput>} - returns output from orca lambda
 */
export const invokeOrcaCopyToArchive = async (
  event: HandlerEvent
): Promise<HandlerOutput> => {
  const functionName = process.env.orca_lambda_copy_to_archive_arn;
  if (!functionName?.length) {
    log.error('Environment orca_lambda_copy_to_archive_arn is not set');
    throw new Error('Environment orca_lambda_copy_to_archive_arn is not set');
  }

  const payload = pick(event, ['input', 'config']);
  const response = await invoke(functionName, payload, 'RequestResponse');
  const responsePayload = response && response.Payload
    ? new TextDecoder('utf-8').decode(response.Payload) : '{}';

  log.debug(`invokeOrcaCopyToArchive returns ${response && responsePayload}`);

  if (!isObject(response) || response.StatusCode !== 200) {
    const errorString = `Failed to invoke orca lambda ${functionName}, response ${response && responsePayload}`;
    log.error(errorString);
    throw new Error(errorString);
  }

  return JSON.parse(responsePayload);
};

/**
 * Lambda handler
 *
 * @param {object} event      - a Cumulus Message
 * @param {object} context    - an AWS Lambda context
 * @returns {Promise<object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
export const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessageWithAssignedPayload
| CumulusRemoteMessage> => await runCumulusTask(invokeOrcaCopyToArchive, event, context);

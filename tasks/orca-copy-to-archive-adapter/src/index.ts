'use strict';

import { Context } from 'aws-lambda';
import cumulusMessageAdapter from '@cumulus/cumulus-message-adapter-js';

import { lambda } from '@cumulus/aws-client/services';
import log from '@cumulus/common/log';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { HandlerEvent } from './types';

async function invokeOrcaCopyToArchive(event: HandlerEvent) {
  const functionName = process.env.OS_ENVIRON_COPY_TO_ARCHIVE_ARN_KEY || '';
  const response = await lambda().invoke({
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({
      input: event.input,
      config: event.config,
    }),
  }).promise();

  log.info(response);
  if (response.StatusCode !== 200) {
    log.error(`Failed to invoke orca lambda ${functionName}, response ${JSON.stringify(response)}`);
    throw new Error(`Failed to invoke orca lambda ${functionName}, response ${JSON.stringify(response)}`);
  }

  return response.Payload;
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event: CumulusMessage | CumulusRemoteMessage,
  context: Context) {
  return await cumulusMessageAdapter.runCumulusTask(
    invokeOrcaCopyToArchive,
    event, context
  );
}

exports.handler = handler;
exports.invokeOrcaCopyToArchive = invokeOrcaCopyToArchive;

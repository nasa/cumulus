'use strict';

/**
 * Utility functions for working with AWS Step Function events/messages
 * @module StepFunctions
 *
 * @example
 * const StepFunctions = require('@cumulus/message/StepFunctions');
 */

import { JSONPath } from 'jsonpath-plus';
import * as s3Utils from '@cumulus/aws-client/S3';
import Logger from '@cumulus/logger';
import { Message } from '@cumulus/types';

const log = new Logger({
  sender: '@cumulus/message/StepFunctions'
});

/**
 * Given a Step Function event, replace specified key in event with contents
 * of S3 remote message
 *
 * @param {Message.CumulusRemoteMessage} event - Source event
 * @returns {Promise<Object>} Updated event with target path replaced by remote message
 * @throws {Error} if target path cannot be found on source event
 *
 * @async
 * @alias module:StepFunctions
 */
export const pullStepFunctionEvent = async (
  event: {
    replace?: Message.ReplaceConfig
  }
): Promise<unknown> => {
  if (!event.replace) return event;

  const remoteMsg = await s3Utils.getJsonS3Object(
    event.replace.Bucket,
    event.replace.Key
  );

  let returnEvent = remoteMsg;
  if (event.replace.TargetPath) {
    const replaceNodeSearch = JSONPath({
      path: event.replace.TargetPath,
      json: event,
      resultType: 'all'
    });
    if (replaceNodeSearch.length !== 1) {
      throw new Error(`Replacement TargetPath ${event.replace.TargetPath} invalid`);
    }
    if (replaceNodeSearch[0].parent) {
      replaceNodeSearch[0].parent[replaceNodeSearch[0].parentProperty] = remoteMsg;
      returnEvent = event;
      delete returnEvent.replace;
    }
  }
  return returnEvent;
};

/**
 * Parse step message with CMA keys and replace specified key in event with contents
 * of S3 remote message
 *
 * @param {CMAMessage} stepMessage - Message for the step
 * @param {string} stepName - Name of the step
 * @returns {Promise<Object>} Parsed and updated event with target path replaced by remote message
 *
 * @async
 * @alias module:StepFunctions
 */

type CMAMessage = {
  cma?: {
    event?: object
  }
  replace?: Message.ReplaceConfig
};

export const parseStepMessage = async (
  stepMessage: CMAMessage,
  stepName: string
) => {
  let flattenedMsg;
  if (stepMessage.cma) {
    const x = { ...stepMessage, ...stepMessage.cma, ...stepMessage.cma.event };
    delete x.cma;
    delete x.event;
    flattenedMsg = x;
  } else {
    flattenedMsg = stepMessage;
  }

  if (flattenedMsg.replace) {
    // Message was too large and output was written to S3
    log.info(`Retrieving ${stepName} output from ${JSON.stringify(flattenedMsg.replace)}`);
    flattenedMsg = await pullStepFunctionEvent(flattenedMsg);
  }
  return <Message.CumulusMessage>flattenedMsg;
};

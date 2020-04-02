'use strict';

/**
 * Utility functions for working with AWS Step Function events/messages
 * @module StepFunctions
 *
 * @example
 * const StepFunctions = require('@cumulus/message/StepFunctions');
 */

const { JSONPath } = require('jsonpath-plus');
const s3Utils = require('@cumulus/aws-client/S3');
const Logger = require('@cumulus/logger');

const log = new Logger({
  sender: '@cumulus/message/StepFunctions'
});

/**
 * Given a Step Function event, replace specified key in event with contents
 * of S3 remote message
 *
 * @param {Object} event - Source event
 * @returns {Promise<Object>} Updated event with target path replaced by remote message
 * @throws {Error} if target path cannot be found on source event
 *
 * @async
 * @alias module:StepFunctions
 */
const pullStepFunctionEvent = async (event) => {
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
 * @param {Object} stepMessage - Message for the step
 * @param {string} stepName - Name of the step
 * @returns {Promise<Object>} Parsed and updated event with target path replaced by remote message
 *
 * @async
 * @alias module:StepFunctions
 */
const parseStepMessage = async (stepMessage, stepName) => {
  let parsedStepMessage = stepMessage;
  if (stepMessage.cma) {
    parsedStepMessage = { ...stepMessage, ...stepMessage.cma, ...stepMessage.cma.event };
    delete parsedStepMessage.cma;
    delete parsedStepMessage.event;
  }

  if (parsedStepMessage.replace) {
    // Message was too large and output was written to S3
    log.info(`Retrieving ${stepName} output from ${JSON.stringify(parsedStepMessage.replace)}`);
    parsedStepMessage = await pullStepFunctionEvent(parsedStepMessage);
  }
  return parsedStepMessage;
};

module.exports = {
  pullStepFunctionEvent,
  parseStepMessage
};

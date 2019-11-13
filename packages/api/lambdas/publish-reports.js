'use strict';

const merge = require('lodash.merge');

const { publishSnsMessage, pullStepFunctionEvent } = require('@cumulus/common/aws');
const { getExecutionUrl } = require('@cumulus/ingest/aws');
const {
  getSfEventMessageObject,
  getSfEventStatus,
  isFailedSfStatus,
  isTerminalSfStatus
} = require('@cumulus/common/cloudwatch-event');
const log = require('@cumulus/common/log');
const {
  getMessageExecutionArn,
  getMessageGranules
} = require('@cumulus/common/message');
const { ActivityStep, LambdaStep } = require('@cumulus/common/sfnStep');
const StepFunctions = require('@cumulus/common/StepFunctions');

const Execution = require('../models/executions');
const Granule = require('../models/granules');
const Pdr = require('../models/pdrs');

/**
 * Publish SNS message for execution reporting.
 *
 * @param {Object} executionRecord - An execution record
 * @param {string} [executionSnsTopicArn]
 *  SNS topic ARN for reporting executions. Defaults to `process.env.execution_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishExecutionSnsMessage(
  executionRecord,
  executionSnsTopicArn = process.env.execution_sns_topic_arn
) {
  return publishSnsMessage(executionSnsTopicArn, executionRecord);
}

/**
 * Publish SNS message for granule reporting.
 *
 * @param {Object} granuleRecord - A granule record
 * @param {string} [granuleSnsTopicArn]
 *   SNS topic ARN for reporting granules. Defaults to `process.env.granule_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishGranuleSnsMessage(
  granuleRecord,
  granuleSnsTopicArn = process.env.granule_sns_topic_arn
) {
  return publishSnsMessage(granuleSnsTopicArn, granuleRecord);
}

/**
 * Publish SNS message for PDR reporting.
 *
 * @param {Object} pdrRecord - A PDR record.
 * @param {string} [pdrSnsTopicArn]
 *   SNS topic ARN for reporting PDRs. Defaults to `process.env.pdr_sns_topic_arn`.
 * @returns {Promise<undefined>}
 */
function publishPdrSnsMessage(
  pdrRecord,
  pdrSnsTopicArn = process.env.pdr_sns_topic_arn
) {
  return publishSnsMessage(pdrSnsTopicArn, pdrRecord);
}

/**
 * Publish execution record to SNS topic.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise}
 */
async function handleExecutionMessage(eventMessage) {
  try {
    const executionRecord = await Execution.generateRecord(eventMessage);
    return await publishExecutionSnsMessage(executionRecord);
  } catch (err) {
    log.fatal(
      `Failed to create database record for execution ${getMessageExecutionArn(eventMessage)}: ${err.message}`,
      'Cause: ', err,
      'Execution message: ', eventMessage
    );
    return Promise.resolve();
  }
}

/**
 * Build a granule record and publish it to SNS for granule reporting.
 *
 * @param {Object} granule - A granule object
 * @param {Object} eventMessage - A workflow execution message
 * @param {string} executionUrl - A Step Function execution URL
 * @param {Object} [executionDescription={}] - Defaults to empty object
 * @param {Date} executionDescription.startDate - Start date of the workflow execution
 * @param {Date} executionDescription.stopDate - Stop date of the workflow execution
 * @returns {Promise}
 */
async function buildAndPublishGranule(
  granule,
  eventMessage,
  executionUrl,
  executionDescription = {}
) {
  try {
    const granuleRecord = await Granule.generateGranuleRecord(
      granule,
      eventMessage,
      executionUrl,
      executionDescription
    );
    return await publishGranuleSnsMessage(granuleRecord);
  } catch (err) {
    log.fatal(
      `Failed to create database record for granule ${granule.granuleId}: ${err.message}`,
      'Cause: ', err,
      'Granule data: ', granule,
      'Execution message: ', eventMessage
    );
    return Promise.resolve();
  }
}

/**
 * Publish individual granule messages to SNS topic.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise}
 */
async function handleGranuleMessages(eventMessage) {
  const granules = getMessageGranules(eventMessage);
  if (!granules) {
    log.info(`No granules to process in the payload: ${JSON.stringify(eventMessage.payload)}`);
    return Promise.resolve();
  }

  const executionArn = getMessageExecutionArn(eventMessage);
  const executionUrl = getExecutionUrl(executionArn);

  let executionDescription;
  try {
    executionDescription = await StepFunctions.describeExecution({ executionArn });
  } catch (err) {
    log.error(`Could not describe execution ${executionArn}`, err);
  }

  try {
    return Promise.all(
      granules
        .map((granule) => buildAndPublishGranule(
          granule,
          eventMessage,
          executionUrl,
          executionDescription
        ))
    );
  } catch (err) {
    log.error(
      'Error handling granule records: ', err,
      'Execution message: ', eventMessage
    );
    return Promise.resolve();
  }
}

/**
 * Publish PDR record to SNS topic.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise<Object|null>}
 */
async function handlePdrMessage(eventMessage) {
  try {
    const pdrRecord = Pdr.generatePdrRecord(eventMessage);
    if (!pdrRecord) return null;
    return await publishPdrSnsMessage(pdrRecord);
  } catch (err) {
    log.fatal(
      `Failed to create database record for PDR ${eventMessage.payload.pdr.name}: ${err.message}`,
      'Error handling PDR from message', err,
      'Execution message', eventMessage
    );
    return null;
  }
}

/**
 * Publish messages to SNS report topics.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {boolean} isTerminalStatus - true if workflow is in a terminal state
 * @param {boolean} isFailedStatus - true if workflow is in a failed state
 * @returns {Promise}
 */
async function publishReportSnsMessages(eventMessage, isTerminalStatus, isFailedStatus) {
  let status;

  if (isTerminalStatus) {
    status = isFailedStatus ? 'failed' : 'completed';
  } else {
    status = 'running';
  }

  merge(eventMessage, {
    meta: {
      status
    }
  });

  return Promise.all([
    handleExecutionMessage(eventMessage),
    handleGranuleMessages(eventMessage),
    handlePdrMessage(eventMessage)
  ]);
}

/**
 * Get message to use for publishing failed execution notifications.
 *
 * Try to get the input to the first failed step in the execution so we can
 * update the status of any granules/PDRs that don't exist in the initial execution
 * input. Falls back to overall execution input.
 *
 * @param {Object} inputMessage - Workflow execution input message
 * @returns {Object} - Execution step message or execution input message
 */
async function getFailedExecutionMessage(inputMessage) {
  const executionArn = getMessageExecutionArn(inputMessage);

  const activityStep = new ActivityStep();
  const lambdaStep = new LambdaStep();
  const failedStepMessage = await lambdaStep.getFirstFailedStepMessage(executionArn)
    || await activityStep.getFirstFailedStepMessage(executionArn);

  // If input from the failed step cannot be retrieved, then fall back to execution
  // input.
  return failedStepMessage || inputMessage;
}

/**
 * Lambda handler for publish-reports Lambda.
 *
 * @param {Object} event - Cloudwatch event
 * @returns {Promise}
 */
async function handler(event) {
  const eventStatus = getSfEventStatus(event);
  const isTerminalStatus = isTerminalSfStatus(eventStatus);
  const isFailedStatus = isFailedSfStatus(eventStatus);

  // For terminal non-failed states, we want the output from the execution.
  // For running states, there isn't any output, so we want input to the execution.
  let eventMessage = isTerminalStatus && !isFailedStatus
    ? getSfEventMessageObject(event, 'output')
    : getSfEventMessageObject(event, 'input', '{}');

  if (isFailedStatus) {
    eventMessage = await getFailedExecutionMessage(eventMessage);
  }

  eventMessage = await pullStepFunctionEvent(eventMessage);

  return publishReportSnsMessages(eventMessage, isTerminalStatus, isFailedStatus);
}

module.exports = {
  handler,
  publishReportSnsMessages
};

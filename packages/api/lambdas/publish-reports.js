'use strict';

const merge = require('lodash.merge');

const aws = require('@cumulus/common/aws');
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
  getMessageGranules,
  getMessagePdr
} = require('@cumulus/common/message');
const StepFunctions = require('@cumulus/common/StepFunctions');

const Granule = require('../models/granules');

/**
 * Publish a message to an SNS topic.
 *
 * Catch any thrown errors and log them.
 *
 * @param {string} snsTopicArn - SNS topic ARN
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise}
 */
async function publishSnsMessage(
  snsTopicArn,
  eventMessage
) {
  try {
    if (!snsTopicArn) {
      throw new Error('Missing SNS topic ARN');
    }

    await aws.sns().publish({
      TopicArn: snsTopicArn,
      Message: JSON.stringify(eventMessage)
    }).promise();
  } catch (err) {
    log.error(`Failed to post message to SNS topic: ${snsTopicArn}`, err);
    log.info('Execution message', eventMessage);
  }
}

/**
 * Publish SNS message for execution reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [executionSnsTopicArn]
 *  SNS topic ARN for reporting executions. Defaults to `process.env.execution_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishExecutionSnsMessage(
  eventMessage,
  executionSnsTopicArn = process.env.execution_sns_topic_arn
) {
  return publishSnsMessage(executionSnsTopicArn, eventMessage);
}

/**
 * Publish SNS message for granule reporting.
 *
 * @param {Object} granule - A granule object
 * @param {string} [granuleSnsTopicArn]
 *   SNS topic ARN for reporting granules. Defaults to `process.env.granule_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishGranuleSnsMessage(
  granule,
  granuleSnsTopicArn = process.env.granule_sns_topic_arn
) {
  return publishSnsMessage(granuleSnsTopicArn, granule);
}

/**
 * Publish SNS message for PDR reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [pdrSnsTopicArn]
 *   SNS topic ARN for reporting PDRs. Defaults to `process.env.pdr_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishPdrSnsMessage(
  eventMessage,
  pdrSnsTopicArn = process.env.pdr_sns_topic_arn
) {
  return publishSnsMessage(pdrSnsTopicArn, eventMessage);
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
    log.info('No granules to process on the message');
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

  return Promise.all(
    granules
      .filter((granule) => granule.granuleId)
      .map((granule) => Granule.buildGranuleRecord(
        granule,
        eventMessage,
        executionUrl,
        executionDescription
      ))
      .map((granuleMessage) => publishGranuleSnsMessage(granuleMessage))
  );
}

/**
 * Publish individual PDR messages to SNS topic.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise}
 */
async function handlePdrMessage(eventMessage) {
  const pdr = getMessagePdr(eventMessage);
  if (!pdr) {
    log.info('No PDRs to process on the message');
    return Promise.resolve();
  }

  if (!pdr.name) {
    log.info('Could not find name on PDR object', pdr);
    return Promise.resolve();
  }

  return publishPdrSnsMessage(pdr);
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
    publishExecutionSnsMessage(eventMessage),
    handleGranuleMessages(eventMessage),
    handlePdrMessage(eventMessage)
  ]);
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

  const eventMessage = isTerminalStatus && !isFailedStatus
    ? getSfEventMessageObject(event, 'output')
    : getSfEventMessageObject(event, 'input', '{}');

  // TODO: Get event message from first failed step from execution history for failed executions
  /*if (isFailedSfStatus) {
    const executionArn = getMessageExecutionArn(eventMessage);
    const executionHistory = await StepFunctions.getExecutionHistory({ executionArn });
    for (let i = 0; i < executionHistory.events.length; i += 1) {
      const sfEvent = executionHistory.events[i];
      updatedEvents.push(getEventDetails(sfEvent));
    }
  }*/

  return publishReportSnsMessages(eventMessage, isTerminalStatus, isFailedStatus);
}

module.exports = {
  handler,
  publishReportSnsMessages
};

'use strict';

const { sns } = require('@cumulus/common/aws');
const {
  getSfEventMessageObject,
  isFailedSfStatus,
  isTerminalSfStatus
} = require('@cumulus/common/cloudwatch-event');
const log = require('@cumulus/common/log');

/**
 * Publish SNS notification for execution reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [executionSnsTopicArn]
 *  SNS topic ARN for reporting executions. Defaults to process.env.execution_sns_topic_arn.
 * @returns {Promise}
 * @throws {Error}
 */
async function publishExecutionSnsMessage(
  eventMessage,
  executionSnsTopicArn = process.env.execution_sns_topic_arn
) {
  if (!executionSnsTopicArn) {
    throw new Error('Missing env variable for executions SNS topic ARN');
  }

  try {
    await sns().publish({
      TopicArn: executionSnsTopicArn,
      Message: JSON.stringify(eventMessage)
    }).promise();
  } catch (err) {
    log.error(`Failed to post message to executions SNS topic: ${executionSnsTopicArn}`);
    log.info('Execution message', eventMessage);
  }
}

/**
 * Publish SNS notification for granule reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [granuleSnsTopicArn]
 *   SNS topic ARN for reporting granules. Defaults to process.env.granule_sns_topic_arn.
 * @returns {Promise}
 * @throws {Error}
 */
async function publishGranuleSnsMessage(
  eventMessage,
  granuleSnsTopicArn = process.env.granule_sns_topic_arn
) {
  if (!granuleSnsTopicArn) {
    throw new Error('Missing env variable for granule SNS topic ARN');
  }

  try {
    await sns().publish({
      TopicArn: granuleSnsTopicArn,
      Message: JSON.stringify(eventMessage)
    }).promise();
  } catch (err) {
    log.error(`Failed to post message to granules SNS topic: ${granuleSnsTopicArn}`);
    log.info('Execution message', eventMessage);
  }
}

/**
 * Publish SNS notification for PDR reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [pdrSnsTopicArn]
 *   SNS topic ARN for reporting PDRs. Defaults to process.env.pdr_sns_topic_arn.
 * @returns {Promise}
 * @throws {Error}
 */
async function publishPdrSnsMessage(
  eventMessage,
  pdrSnsTopicArn = process.env.pdr_sns_topic_arn
) {
  if (!pdrSnsTopicArn) {
    throw new Error('Missing env variable for PDR SNS topic ARN');
  }

  try {
    await sns().publish({
      TopicArn: pdrSnsTopicArn,
      Message: JSON.stringify(eventMessage)
    }).promise();
  } catch (err) {
    log.error(`Failed to post message to PDRs SNS topic: ${pdrSnsTopicArn}`);
    log.info('Execution message', eventMessage);
  }
}

/**
 * Lambda handler for publish-notifications Lambda.
 *
 * @param {Object} event - Cloudwatch event
 * @returns {Promise}
 */
async function handler(event) {
  // TODO: if execution is a failure, this won't return anything
  const eventMessage = getSfEventMessageObject(event, 'output');

  const finished = isTerminalSfStatus(event);
  const failed = isFailedSfStatus(event);

  // if this is the sns call at the end of the execution
  if (finished) {
    eventMessage.meta.status = failed ? 'failed' : 'completed';
    // TODO: What does this do?
    // const granuleId = get(eventMessage, 'meta.granuleId', null);
    // if (granuleId) {
    //   await setGranuleStatus(
    //     granuleId,
    //     // config.stack,
    //     // TODO create env var
    //     process.env.stackName,
    //     // config.bucket,
    //     // TODO create env var
    //     process.env.bucket,
    //     // config.stateMachine,
    //     // config.executionName,
    //     eventMessage.meta.status
    //   );
    // }
  } else {
    eventMessage.meta.status = 'running';
  }

  return Promise.all([
    publishExecutionSnsMessage(eventMessage),
    publishGranuleSnsMessage(eventMessage),
    publishPdrSnsMessage(eventMessage)
  ]);
}

module.exports = {
  handler
};

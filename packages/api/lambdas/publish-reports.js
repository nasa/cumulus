'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const log = require('@cumulus/common/log');

const Pdr = require('../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

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
 * Publish PDR record to SNS topic.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise<Object|null>}
 */
async function handlePdrMessage(eventMessage) {
  try {
    const pdrRecord = Pdr.generatePdrRecord(eventMessage);
    if (pdrRecord) await publishPdrSnsMessage(pdrRecord);
  } catch (err) {
    log.fatal(
      `Failed to create database record for PDR ${eventMessage.payload.pdr.name}: ${err.message}`,
      'Error handling PDR from message', err,
      'Execution message', eventMessage
    );
  }
}

/**
 * Publish messages to SNS report topics.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise}
 */
function publishReportSnsMessages(eventMessage) {
  return handlePdrMessage(eventMessage);
}

/**
 * Lambda handler for publish-reports Lambda.
 *
 * @param {Object} event - Cloudwatch event
 * @returns {Promise}
 */
async function handler(event) {
  const eventMessage = await getCumulusMessageFromExecutionEvent(event);
  return publishReportSnsMessages(eventMessage);
}

module.exports = {
  handler,
  handlePdrMessage,
  publishReportSnsMessages
};

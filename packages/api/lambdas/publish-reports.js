'use strict';

const { publishSnsMessage } = require('@cumulus/common/aws');
const { getExecutionUrl } = require('@cumulus/ingest/aws');
const log = require('@cumulus/common/log');
const {
  getMessageExecutionArn,
  getMessageGranules
} = require('@cumulus/common/message');
const StepFunctions = require('@cumulus/common/StepFunctions');

const Granule = require('../models/granules');
const Pdr = require('../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

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
 * Lambda handler for publish-reports Lambda.
 *
 * @param {Object} event - Cloudwatch event
 * @returns {Promise}
 */
async function handler(event) {
  const eventMessage = await getCumulusMessageFromExecutionEvent(event);

  return Promise.all([
    handleGranuleMessages(eventMessage),
    handlePdrMessage(eventMessage)
  ]);
}

module.exports = {
  handler
};

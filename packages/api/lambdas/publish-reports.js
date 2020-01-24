'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { getExecutionUrl } = require('@cumulus/ingest/aws');
const log = require('@cumulus/common/log');
const {
  getMessageExecutionArn,
  getMessageGranules
} = require('@cumulus/common/message');
const StepFunctions = require('@cumulus/common/StepFunctions');
const { isNil } = require('@cumulus/common/util');

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

const publishGranuleRecord = async (granuleRecord) => {
  try {
    await publishGranuleSnsMessage(granuleRecord);
  } catch (err) {
    log.fatal(
      `Failed to create database record for granule ${granuleRecord.granuleId}: ${err.message}`,
      'Cause: ', err,
      'Granule record: ', granuleRecord
    );
  }
};

const getGranuleRecordsFromCumulusMessage = async (cumulusMessage) => {
  const granules = getMessageGranules(cumulusMessage);
  if (!granules) {
    log.info(`No granules to process in the payload: ${JSON.stringify(cumulusMessage.payload)}`);
    return [];
  }

  const executionArn = getMessageExecutionArn(cumulusMessage);
  const executionUrl = getExecutionUrl(executionArn);

  let executionDescription;
  try {
    executionDescription = await StepFunctions.describeExecution({ executionArn });
  } catch (err) {
    log.error(`Could not describe execution ${executionArn}`, err);
  }

  const promisedGranuleRecords = granules
    .map(async (granule) => {
      try {
        return await Granule.generateGranuleRecord(
          granule,
          cumulusMessage,
          executionUrl,
          executionDescription
        );
      } catch (err) {
        log.error(
          'Error handling granule records: ', err,
          'Execution message: ', cumulusMessage
        );
        return null;
      }
    });

  const granuleRecords = await Promise.all(promisedGranuleRecords);

  return granuleRecords.filter((r) => !isNil(r));
};

/**
 * Publish individual granule messages to SNS topic.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise}
 */
async function handleGranuleMessages(eventMessage) {
  const granuleRecords = await getGranuleRecordsFromCumulusMessage(eventMessage);
  await Promise.all(granuleRecords.map(publishGranuleRecord));
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
  return Promise.all([
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
  const eventMessage = await getCumulusMessageFromExecutionEvent(event);
  return publishReportSnsMessages(eventMessage);
}

module.exports = {
  getGranuleRecordsFromCumulusMessage,
  handler,
  handleGranuleMessages,
  handlePdrMessage,
  publishGranuleRecord,
  publishReportSnsMessages
};

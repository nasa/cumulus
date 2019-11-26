'use strict';

const get = require('lodash.get');
const set = require('lodash.set');

const {
  dynamodbDocClient,
  publishSnsMessage,
  pullStepFunctionEvent
} = require('@cumulus/common/aws');
const { getExecutionUrl } = require('@cumulus/ingest/aws');
const log = require('@cumulus/common/log');
const {
  getMessageExecutionArn,
  getMessageGranules
} = require('@cumulus/common/message');
const {
  getStepExitedEvent,
  getTaskExitedEventOutput,
  SfnStep
} = require('@cumulus/common/sfnStep');
const StepFunctions = require('@cumulus/common/StepFunctions');

const Execution = require('../models/executions');
const Granule = require('../models/granules');
const Pdr = require('../models/pdrs');

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

const buildExecutionDocClientUpdateParams = (TableName, item) => {
  const ExpressionAttributeNames = {};
  const ExpressionAttributeValues = {};
  const setUpdateExpressions = [];

  Object.entries(item).forEach(([key, value]) => {
    if (key === 'arn') return;

    ExpressionAttributeNames[`#${key}`] = key;
    ExpressionAttributeValues[`:${key}`] = value;

    if (item.status === 'running') {
      if (['createdAt', 'updatedAt', 'timestamp', 'originalPayload'].includes(key)) {
        setUpdateExpressions.push(`#${key} = :${key}`);
      } else {
        setUpdateExpressions.push(`#${key} = if_not_exists(#${key}, :${key})`);
      }
    } else {
      setUpdateExpressions.push(`#${key} = :${key}`);
    }
  });

  return {
    TableName,
    Key: { arn: item.arn },
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    UpdateExpression: `SET ${setUpdateExpressions.join(', ')}`
  };
};

/**
 * Given a Cumulus message, write an execution item to DynamoDB
 *
 * @param {Object} cumulusMessage - Cumulus message
 * @returns {Promise}
 */
async function handleExecutionMessage(cumulusMessage) {
  try {
    const updateParams = buildExecutionDocClientUpdateParams(
      process.env.ExecutionsTable,
      Execution.generateRecord(cumulusMessage)
    );

    await dynamodbDocClient().update(updateParams).promise();
  } catch (err) {
    const executionArn = getMessageExecutionArn(cumulusMessage);

    log.fatal(
      `Failed to create database record for execution ${executionArn}: ${err.message}`,
      'Cause: ', err,
      'Execution message: ', cumulusMessage
    );
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
  try {
    const executionArn = getMessageExecutionArn(inputMessage);
    const { events } = await StepFunctions.getExecutionHistory({ executionArn });

    const stepFailedEvents = events.filter(
      (event) =>
        ['ActivityFailed', 'LambdaFunctionFailed'].includes(event.type)
    );
    const lastStepFailedEvent = stepFailedEvents[stepFailedEvents.length - 1];
    const failedStepExitedEvent = getStepExitedEvent(events, lastStepFailedEvent);

    if (!failedStepExitedEvent) {
      log.info(
        `Could not retrieve output from last failed step in execution ${executionArn}, falling back to execution input`,
        'Error:', new Error(`Could not find TaskStateExited event after step ID ${lastStepFailedEvent.id} for execution ${executionArn}`)
      );

      const exception = lastStepFailedEvent.lambdaFunctionFailedEventDetails
        || lastStepFailedEvent.activityFailedEventDetails;

      // If input from the failed step cannot be retrieved, then fall back to execution
      // input.
      return {
        ...inputMessage,
        exception
      };
    }

    const taskExitedEventOutput = getTaskExitedEventOutput(failedStepExitedEvent);
    return await SfnStep.parseStepMessage(
      JSON.parse(taskExitedEventOutput),
      failedStepExitedEvent.resource
    );
  } catch (err) {
    return inputMessage;
  }
}

const executionStatusToWorkflowStatus = (executionStatus) => {
  const statusMap = {
    ABORTED: 'failed',
    FAILED: 'failed',
    RUNNING: 'running',
    SUCCEEDED: 'completed',
    TIMED_OUT: 'failed'
  };

  return statusMap[executionStatus];
};

const getCumulusMessageFromExecutionEvent = async (executionEvent) => {
  let cumulusMessage;

  if (executionEvent.detail.status === 'RUNNING') {
    cumulusMessage = JSON.parse(executionEvent.detail.input);
  } else if (executionEvent.detail.status === 'SUCCEEDED') {
    cumulusMessage = JSON.parse(executionEvent.detail.output);
  } else {
    const inputMessage = JSON.parse(get(executionEvent, 'detail.input', '{}'));
    cumulusMessage = await getFailedExecutionMessage(inputMessage);
  }

  const fullCumulusMessage = await pullStepFunctionEvent(cumulusMessage);

  const workflowStatus = executionStatusToWorkflowStatus(executionEvent.detail.status);
  set(fullCumulusMessage, 'meta.status', workflowStatus);

  return fullCumulusMessage;
};

/**
 * Lambda handler for publish-reports Lambda.
 *
 * @param {Object} event - Cloudwatch event
 * @returns {Promise}
 */
async function handler(event) {
  const eventMessage = await getCumulusMessageFromExecutionEvent(event);

  return Promise.all([
    handleExecutionMessage(eventMessage),
    handleGranuleMessages(eventMessage),
    handlePdrMessage(eventMessage)
  ]);
}

module.exports = {
  handler
};

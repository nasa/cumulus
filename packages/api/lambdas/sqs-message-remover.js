'use strict';

const get = require('lodash.get');

const {
  deleteSQSMessage,
  sqs
} = require('@cumulus/common/aws');
const {
  getSfEventMessageObject,
  getSfEventStatus,
  isFailedSfStatus,
  isSfExecutionEvent,
  isTerminalSfStatus
} = require('@cumulus/common/cloudwatch-event');
const log = require('@cumulus/common/log');


/**
 * Determine if the SQS queue update is needed for the event
 *
 * Return false if:
 *   - Event has no workflow status
 *   - Workflow is not in a terminal state
 *   - Event message has no 'meta.eventSource' property or eventSource type is not 'sqs'
 *   - Event message property meta.eventSource.deleteCompletedMessage is not true
 *   - Event message property meta.eventSource.workflow_name is not the same as meta.workflow_name
 *
 * @param {Object} event - A workflow execution event
 * @returns {boolean} True if SQS queue update is needed
 */
function isSqsQueueUpdateNeeded(event) {
  const eventStatus = getSfEventStatus(event);
  const eventMessage = getSfEventMessageObject(event, 'input', '{}');

  if (!isSfExecutionEvent(event)
    || !isTerminalSfStatus(eventStatus)
    || get(eventMessage, 'meta.eventSource.type') !== 'sqs'
    || get(eventMessage, 'meta.eventSource.deleteCompletedMessage', false) !== true
    || get(eventMessage, 'meta.eventSource.workflow_name') === null
    || get(eventMessage, 'meta.eventSource.workflow_name') !== get(eventMessage, 'meta.workflow_name')) {
    return false;
  }

  return true;
}

/**
 * Update SQS queue when workflow of the message is completed
 *
 * @param {Object} event - Cloudwatch event
 */
async function updateSqsQueue(event) {
  if (!isSqsQueueUpdateNeeded(event)) return 'Not a valid event for updating SQS queue';

  const eventStatus = getSfEventStatus(event);
  const eventMessage = getSfEventMessageObject(event, 'input', '{}');

  const {
    queueUrl,
    receiptHandle
  } = eventMessage.meta.eventSource;

  if (isFailedSfStatus(eventStatus)) {
    // update visibilityTimeout to 5s so the message can be retried
    log.debug(`update message ${receiptHandle} queue ${queueUrl} visibilityTimeout to 5s`);

    const params = {
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 5
    };
    await sqs().changeMessageVisibility(params).promise();
  } else {
    // delete SQS message from the source queue when the workflow succeeded
    log.debug(`remove message ${receiptHandle} from queue ${queueUrl}`);
    await deleteSQSMessage(queueUrl, receiptHandle);
  }

  return Promise.resolve();
}

/**
 * Lambda handler for sqs-message-remover Lambda
 *
 * This Lambda function works together with sqs-message-consumer. sqs-message-consumer lambda
 * consumes message from SQS queue, and sqs-message-remover deletes the message from the SQS
 * queue when the workflow triggered by the message is completed successfully.
 *
 * @param {Object} event - Cloudwatch event
 * @returns {Promise}
 */
async function handler(event) {
  return updateSqsQueue(event);
}

module.exports = {
  handler
};

const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');

const { isNil } = require('@cumulus/common/util');

const awsServices = require('./services');
const { improveStackTrace } = require('./utils');

/**
* Send a message to AWS SQS
*
* @param {string} queueUrl - url of the SQS queue
* @param {string|Object} message - either string or object message. If an
*   object it will be serialized into a JSON string.
* @returns {Promise} - resolves when the messsage has been sent
**/
exports.sendSQSMessage = (queueUrl, message) => {
  let messageBody;
  if (isString(message)) messageBody = message;
  else if (isObject(message)) messageBody = JSON.stringify(message);
  else throw new Error('body type is not accepted');

  return awsServices.sqs().sendMessage({
    MessageBody: messageBody,
    QueueUrl: queueUrl
  }).promise();
};

/**
 * Receives SQS messages from a given queue. The number of messages received
 * can be set and the timeout is also adjustable.
 *
 * @param {string} queueUrl - url of the SQS queue
 * @param {Object} options - options object
 * @param {integer} [options.numOfMessages=1] - number of messages to read from the queue
 * @param {integer} [options.visibilityTimeout=30] - number of seconds a message is invisible
 *   after read
 * @param {integer} [options.waitTimeSeconds=0] - number of seconds to poll SQS queue (long polling)
 * @returns {Promise.<Array>} an array of messages
 */
exports.receiveSQSMessages = async (queueUrl, options) => {
  const params = {
    QueueUrl: queueUrl,
    AttributeNames: ['All'],
    // 0 is a valid value for VisibilityTimeout
    VisibilityTimeout: isNil(options.visibilityTimeout) ? 30 : options.visibilityTimeout,
    WaitTimeSeconds: options.waitTimeSeconds || 0,
    MaxNumberOfMessages: options.numOfMessages || 1
  };

  const messages = await awsServices.sqs().receiveMessage(params).promise();

  // convert body from string to js object
  if (Object.prototype.hasOwnProperty.call(messages, 'Messages')) {
    messages.Messages.forEach((mes) => {
      mes.Body = JSON.parse(mes.Body); // eslint-disable-line no-param-reassign
    });

    return messages.Messages;
  }
  return [];
};

/**
 * Delete a given SQS message from a given queue.
 *
 * @param {string} queueUrl - url of the SQS queue
 * @param {integer} receiptHandle - the unique identifier of the sQS message
 * @returns {Promise} an AWS SQS response
 */
exports.deleteSQSMessage = improveStackTrace(
  (QueueUrl, ReceiptHandle) =>
    awsServices.sqs().deleteMessage({ QueueUrl, ReceiptHandle }).promise()
);

/**
 * Test if an SQS queue exists
 *
 * @param {Object} queue - queue name or url
 * @returns {Promise<boolean>} - a Promise that will resolve to a boolean indicating
 *                               if the queue exists
 */
exports.sqsQueueExists = (queue) => {
  const QueueName = queue.split('/').pop();
  return awsServices.sqs().getQueueUrl({ QueueName }).promise()
    .then(() => true)
    .catch((e) => {
      if (e.code === 'AWS.SimpleQueueService.NonExistentQueue') return false;
      throw e;
    });
};

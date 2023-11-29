/**
 * @module SQS
 */
import Logger from '@cumulus/logger';
import get from 'lodash/get';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
import isNil from 'lodash/isNil';
import { SQSRecord } from 'aws-lambda';

import { sqs } from './services';
import { improveStackTrace } from './utils';

const log = new Logger({ sender: '@cumulus/aws-client/SQS' });
export interface SQSMessage extends AWS.SQS.Message {
  ReceiptHandle: string
}

export const getQueueNameFromUrl = (queueUrl: string) => queueUrl.split('/').pop();

export const getQueueUrl = (sourceArn: string, queueName: string) => {
  const arnParts = sourceArn.split(':');
  return `https://sqs.${arnParts[3]}.amazonaws.com/${arnParts[4]}/${queueName}`;
};

export const getQueueUrlByName = async (queueName: string) => {
  const response = await sqs().getQueueUrl({ QueueName: queueName }).promise();
  return response.QueueUrl;
};

/**
 * Create an SQS Queue.  Properly handles localstack queue URLs
 *
 * @param {string} QueueName - queue name
 * @returns {Promise<string>} the Queue URL
 *
 * @static
 */
export async function createQueue(QueueName: string) {
  const createQueueResponse = await sqs().createQueue({
    QueueName,
  })
    .on('error', (error) => log.error(error))
    .promise();

  return createQueueResponse.QueueUrl;
}

export const deleteQueue = (queueUrl: string) =>
  sqs().deleteQueue({
    QueueUrl: queueUrl,
  })
    .on('error', (error) => log.error(error))
    .promise();

export const getQueueAttributes = async (queueName: string) => {
  const queueUrl = await getQueueUrlByName(queueName);

  if (!queueUrl) {
    throw new Error(`Unable to determine QueueUrl of ${queueName}`);
  }

  const response = await sqs().getQueueAttributes({
    AttributeNames: ['All'],
    QueueUrl: queueUrl,
  }).promise();

  return {
    ...response.Attributes,
    name: queueName,
  };
};

/**
 * Send a message to AWS SQS
 *
 * @param {string} queueUrl - url of the SQS queue
 * @param {string|Object} message - either string or object message. If an
 *   object it will be serialized into a JSON string.
 * @param {Logger} [logOverride] - optional Logger passed in for testing
 * @returns {Promise} resolves when the messsage has been sent

 **/
export const sendSQSMessage = improveStackTrace(
  (queueUrl: string, message: string | object, logOverride: Logger) => {
    const logger = logOverride || log;
    let messageBody;
    if (isString(message)) messageBody = message;
    else if (isObject(message)) messageBody = JSON.stringify(message);
    else throw new Error('body type is not accepted');

    return sqs().sendMessage({
      MessageBody: messageBody,
      QueueUrl: queueUrl,
    }).on('error', (error) => logger.error(error))
      .promise();
  }
);

type ReceiveSQSMessagesOptions = {
  numOfMessages?: number,
  visibilityTimeout?: number,
  waitTimeSeconds?: number
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
 * @returns {Promise<Array>} an array of messages
 */
export const receiveSQSMessages = async (
  queueUrl: string,
  options: ReceiveSQSMessagesOptions
): Promise<SQSMessage[]> => {
  const params = {
    QueueUrl: queueUrl,
    AttributeNames: ['All'],
    // 0 is a valid value for VisibilityTimeout
    VisibilityTimeout: isNil(options.visibilityTimeout) ? 30 : options.visibilityTimeout,
    WaitTimeSeconds: options.waitTimeSeconds || 0,
    MaxNumberOfMessages: options.numOfMessages || 1,
  };

  const messages = await sqs().receiveMessage(params)
    .on('error', (error) => log.error(error)).promise();

  return <SQSMessage[]>(messages.Messages ?? []);
};

export const parseSQSMessageBody = (
  message: SQSRecord | AWS.SQS.Message
): { [key: string]: any } =>
  JSON.parse(get(message, 'Body', get(message, 'body')) ?? '{}');

/**
 * Delete a given SQS message from a given queue.
 *
 * @param {string} queueUrl - url of the SQS queue
 * @param {integer} receiptHandle - the unique identifier of the sQS message
 * @returns {Promise} an AWS SQS response
 */
export const deleteSQSMessage = improveStackTrace(
  (QueueUrl: string, ReceiptHandle: string) =>
    sqs().deleteMessage({ QueueUrl, ReceiptHandle })
      .on('error', (error) => log.error(error))
      .promise()
);

/**
 * Test if an SQS queue exists
 *
 * @param {Object} queueUrl     - queue url
 * @returns {Promise<boolean>}  - a Promise that will resolve to a boolean indicating
 *                               if the queue exists
 */
export const sqsQueueExists = async (queueUrl: string) => {
  const QueueName = getQueueNameFromUrl(queueUrl);

  if (!QueueName) {
    throw new Error(`Unable to determine QueueName from ${queueUrl}`);
  }

  try {
    await sqs().getQueueUrl({ QueueName }).promise();
    return true;
  } catch (error) {
    if (error.name === 'QueueDoesNotExist') {
      log.warn(`Queue ${QueueName} does not exist`);
      return false;
    }
    log.error(error);
    throw error;
  }
};

//@ts-check
/**
 * @module SQS
 */
import Logger from '@cumulus/logger';
import { CumulusMessage } from '@cumulus/types/message';
import get from 'lodash/get';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
import isNil from 'lodash/isNil';
import { SQSRecord } from 'aws-lambda';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  Message,
  QueueAttributeName,
  ReceiveMessageCommand,
  SendMessageCommand } from '@aws-sdk/client-sqs';

import { StepFunctionEventBridgeEvent } from './Lambda';
import { sqs } from './services';

const log = new Logger({ sender: '@cumulus/aws-client/SQS' });
export interface SQSMessage extends Message {
  ReceiptHandle: string
}

export const getQueueNameFromUrl = (queueUrl: string) => queueUrl.split('/').pop();

export const getQueueUrl = (sourceArn: string, queueName: string) => {
  const arnParts = sourceArn.split(':');
  return `https://sqs.${arnParts[3]}.amazonaws.com/${arnParts[4]}/${queueName}`;
};

export const getQueueUrlByName = async (queueName: string) => {
  const command = new GetQueueUrlCommand({ QueueName: queueName });
  const response = await sqs().send(command);

  return response.QueueUrl;
};

/**
 * Create an SQS Queue.  Properly handles localstack queue URLs
 */
export async function createQueue(QueueName: string) {
  const command = new CreateQueueCommand({ QueueName });

  const createQueueResponse = await sqs().send(command)
    .catch((error) => {
      log.error(error);
      throw error;
    });

  return createQueueResponse.QueueUrl;
}

export const deleteQueue = (queueUrl: string) => {
  const command = new DeleteQueueCommand({ QueueUrl: queueUrl });

  return sqs().send(command)
    .catch((error) => {
      log.error(error);
      throw error;
    });
};

export const getQueueAttributes = async (queueName: string) => {
  const queueUrl = await getQueueUrlByName(queueName);

  if (!queueUrl) {
    throw new Error(`Unable to determine QueueUrl of ${queueName}`);
  }

  const command = new GetQueueAttributesCommand({
    AttributeNames: ['All'],
    QueueUrl: queueUrl,
  });

  const response = await sqs().send(command);

  return {
    ...response.Attributes,
    name: queueName,
  };
};

/**
 * Send a message to AWS SQS
 **/
export const sendSQSMessage = (
  queueUrl: string,
  message: string | object,
  logOverride: Logger | undefined = undefined
) => {
  const logger = logOverride || log;
  let messageBody;
  if (isString(message)) messageBody = message;
  else if (isObject(message)) messageBody = JSON.stringify(message);
  else throw new Error('body type is not accepted');

  const command = new SendMessageCommand({
    MessageBody: messageBody,
    QueueUrl: queueUrl,
  });

  return sqs().send(command)
    .catch((error) => {
      logger.error(error);
      throw error;
    });
};

type ReceiveSQSMessagesOptions = {
  numOfMessages?: number,
  visibilityTimeout?: number,
  waitTimeSeconds?: number
};

/**
 * Receives SQS messages from a given queue. The number of messages received
 * can be set and the timeout is also adjustable.
 */
export const receiveSQSMessages = async (
  queueUrl: string,
  options: ReceiveSQSMessagesOptions
): Promise<SQSMessage[]> => {
  const params = {
    QueueUrl: queueUrl,
    AttributeNames: [QueueAttributeName.All],
    // 0 is a valid value for VisibilityTimeout
    VisibilityTimeout: isNil(options.visibilityTimeout) ? 30 : options.visibilityTimeout,
    WaitTimeSeconds: options.waitTimeSeconds || 0,
    MaxNumberOfMessages: options.numOfMessages || 1,
  };

  const command = new ReceiveMessageCommand(params);

  const messages = await sqs().send(command)
    .catch((error) => {
      log.error(error);
      throw error;
    });

  return <SQSMessage[]>(messages.Messages ?? []);
};

/**
 * Bare check for SQS message Shape
 */
export const isSQSRecordLike = (message: Object): message is SQSRecord => (
  message instanceof Object
  && ('body' in message || 'Body' in message)
);

/**
 * Extract SQS message body
 */
export const parseSQSMessageBody = (
  message: SQSRecord | Message
): StepFunctionEventBridgeEvent | CumulusMessage | SQSRecord =>
  JSON.parse(get(message, 'Body', get(message, 'body')) ?? '{}');

/**
 * Delete a given SQS message from a given queue.
 */
export const deleteSQSMessage = (QueueUrl: string, ReceiptHandle: string) => {
  const command = new DeleteMessageCommand({ QueueUrl, ReceiptHandle });

  return sqs().send(command)
    .catch((error) => {
      log.error(error);
      throw error;
    });
};

/**
 * Test if an SQS queue exists
 */
export const sqsQueueExists = async (queueUrl: string) => {
  const QueueName = getQueueNameFromUrl(queueUrl);

  if (!QueueName) {
    throw new Error(`Unable to determine QueueName from ${queueUrl}`);
  }

  const command = new GetQueueUrlCommand({ QueueName });

  try {
    await sqs().send(command);
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

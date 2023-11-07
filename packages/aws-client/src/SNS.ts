/**
 * @module SNS
 */

import pRetry from 'p-retry';
import Logger from '@cumulus/logger';
import {
  PublishCommand,
  SubscribeCommand,
  UnsubscribeCommand,
  ListSubscriptionsByTopicCommand,
  CreateTopicCommand,
  DeleteTopicCommand,
  ConfirmSubscriptionCommand,
  SNSClient,
} from '@aws-sdk/client-sns';

const log = new Logger({ sender: 'aws-client/sns' });
/**
 * Helper function for sending SNS messages for sdk v3, mainly for testing purposes
 *
 * @param {any} messageParams - SNS message
 * @param {string} messageType - Type of sns request
 * @returns {Promise<any>}
 */
export const sendSNSMessage = async (
  messageParams: any,
  messageType: string
) => {
  const snsClient = new SNSClient({});
  let command;
  switch (messageType) {
    case 'PublishCommand':
      command = new PublishCommand(messageParams);
      return await snsClient.send(command);
    case 'SubscribeCommand':
      command = new SubscribeCommand(messageParams);
      return await snsClient.send(command);
    case 'UnsubscribeCommand':
      command = new UnsubscribeCommand(messageParams);
      return await snsClient.send(command);
    case 'ListSubscriptionsByTopicCommand':
      command = new ListSubscriptionsByTopicCommand(messageParams);
      return await snsClient.send(command);
    case 'CreateTopicCommand':
      command = new CreateTopicCommand(messageParams);
      return await snsClient.send(command);
    case 'DeleteTopicCommand':
      command = new DeleteTopicCommand(messageParams);
      return await snsClient.send(command);
    case 'ConfirmSubscriptionCommand':
      command = new ConfirmSubscriptionCommand(messageParams);
      return await snsClient.send(command);
    default:
      throw new Error('Unknown SNS command');
  }
};

/**
 * Publish a message to an SNS topic. Does not catch
 * errors, to allow more specific handling by the caller.
 *
 * @param {string} snsTopicArn - SNS topic ARN
 * @param {Object} message - Message object
 * @param {Object} retryOptions - options to control retry behavior when publishing
 * a message fails. See https://github.com/tim-kos/node-retry#retryoperationoptions
 * @returns {Promise<undefined>}
 */
export const publishSnsMessage = async (
  snsTopicArn: string,
  message: any,
  retryOptions = {}
) =>
  await pRetry(
    async () => {
      if (!snsTopicArn) {
        throw new pRetry.AbortError('Missing SNS topic ARN');
      }
      sendSNSMessage({
        TopicArn: snsTopicArn,
        Message: JSON.stringify(message),
      }, 'PublishCommand');
    },
    {
      maxTimeout: 5000,
      onFailedAttempt: (err) => log.debug(`publishSnsMessage('${snsTopicArn}', '${JSON.stringify(message)}') failed with ${err.retriesLeft} retries left: ${JSON.stringify(err)}`),
      ...retryOptions,
    }
  );

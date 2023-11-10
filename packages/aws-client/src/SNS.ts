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
} from '@aws-sdk/client-sns';
import { sns } from './services';

const log = new Logger({ sender: 'aws-client/sns' });

/**
 * Helper function for sending SNS messages for sdk v3, decides by type
 *
 * @param {any} messageParams - SNS message
 * @param {string} messageType - Type of sns request
 * @returns {Promise<any>}
 */
export const sendSNSMessage = async function (
  messageParams: any,
  messageType: string
) {
  let command;
  try {
    switch (messageType) {
      case 'PublishCommand':
        command = new PublishCommand(messageParams);
        return await sns().send(command);
      case 'SubscribeCommand':
        command = new SubscribeCommand(messageParams);
        return await sns().send(command);
      case 'UnsubscribeCommand':
        command = new UnsubscribeCommand(messageParams);
        return await sns().send(command);
      case 'ListSubscriptionsByTopicCommand':
        command = new ListSubscriptionsByTopicCommand(messageParams);
        return await sns().send(command);
      case 'CreateTopicCommand':
        command = new CreateTopicCommand(messageParams);
        return await sns().send(command);
      case 'DeleteTopicCommand':
        command = new DeleteTopicCommand(messageParams);
        return await sns().send(command);
      case 'ConfirmSubscriptionCommand':
        command = new ConfirmSubscriptionCommand(messageParams);
        return await sns().send(command);
      default:
        return undefined;
    }
  } catch (error) {
    throw new Error(`SNS Command${messageType} failed with ${error}`);
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

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
 * Helper function for sending SNS messages for sdk v3, mainly for testing purposes
 *
 * @param {any} messageParams - SNS message
 * @param {string} messageType - Type of sns request
 * @param {Object} retryOptions - options to control retry behavior when publishing
 * a message fails. See https://github.com/tim-kos/node-retry#retryoperationoptions
 * @returns {Promise<any>}
 */
export const sendSNSMessage = async (
  messageParams: any,
  messageType: string,
  retryOptions = {}
) =>
  await pRetry(
    async () => {
      switch (messageType) {
        case 'PublishCommand':
          return await sns().send(new PublishCommand(messageParams));
        case 'SubscribeCommand':
          return await sns().send(new SubscribeCommand(messageParams));
        case 'UnsubscribeCommand':
          return await sns().send(new UnsubscribeCommand(messageParams));
        case 'ListSubscriptionsByTopicCommand':
          return await sns().send(new ListSubscriptionsByTopicCommand(messageParams));
        case 'CreateTopicCommand':
          return await sns().send(new CreateTopicCommand(messageParams));
        case 'DeleteTopicCommand':
          return await sns().send(new DeleteTopicCommand(messageParams));
        case 'ConfirmSubscriptionCommand':
          return await sns().send(new ConfirmSubscriptionCommand(messageParams));
        default:
          throw new Error('Unknown SNS command');
      }
    },
    {
      maxTimeout: 1000,
      onFailedAttempt: (err) => log.debug(`SNSCOMMAND('${messageType}', '${JSON.stringify(messageParams)}') failed with ${JSON.stringify(err)}, retries left: ${err.retriesLeft}`),
      ...retryOptions,
    }
  );

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

      await sns().send(
        new PublishCommand({
          TopicArn: snsTopicArn,
          Message: JSON.stringify(message),
        })
      );
    },
    {
      maxTimeout: 5000,
      onFailedAttempt: (err) => log.debug(`publishSnsMessage('${snsTopicArn}', '${JSON.stringify(message)}') failed with ${err.retriesLeft} retries left: ${JSON.stringify(err)}`),
      ...retryOptions,
    }
  );

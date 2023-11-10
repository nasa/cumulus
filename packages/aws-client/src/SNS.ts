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
  PublishCommandInput,
  SubscribeCommandInput,
  UnsubscribeCommandInput,
  ListSubscriptionsByTopicCommandInput,
  CreateTopicCommandInput,
  DeleteTopicCommandInput,
  ConfirmSubscriptionCommandInput,
} from '@aws-sdk/client-sns';
import { sns } from './services';

const log = new Logger({ sender: 'aws-client/sns' });

export const sendPublishCommand = async function (
  messageParams: PublishCommandInput
) {
  return await sns().send(new PublishCommand(messageParams));
};

export const sendSubscribeCommand = async function (
  messageParams: SubscribeCommandInput
) {
  return await sns().send(new SubscribeCommand(messageParams));
};

export const sendUnsubscribeCommand = async function (
  messageParams: UnsubscribeCommandInput
) {
  return await sns().send(new UnsubscribeCommand(messageParams));
};

export const sendListSubscriptionsCommand = async function (
  messageParams: ListSubscriptionsByTopicCommandInput
) {
  return await sns().send(new ListSubscriptionsByTopicCommand(messageParams));
};

export const sendCreateTopicCommand = async function (
  messageParams: CreateTopicCommandInput
) {
  return await sns().send(new CreateTopicCommand(messageParams));
};

export const sendDeleteTopicCommand = async function (
  messageParams: DeleteTopicCommandInput
) {
  return await sns().send(new DeleteTopicCommand(messageParams));
};

export const sendConfirmSubscriptionCommand = async function (
  messageParams: ConfirmSubscriptionCommandInput
) {
  return await sns().send(new ConfirmSubscriptionCommand(messageParams));
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

      sendPublishCommand({
        TopicArn: snsTopicArn,
        Message: JSON.stringify(message),
      });
    },
    {
      maxTimeout: 5000,
      onFailedAttempt: (err) => log.debug(`publishSnsMessage('${snsTopicArn}', '${JSON.stringify(message)}') failed with ${err.retriesLeft} retries left: ${JSON.stringify(err)}`),
      ...retryOptions,
    }
  );

module.exports = {
  publishSnsMessage,
  sendCreateTopicCommand,
  sendDeleteTopicCommand,
  sendConfirmSubscriptionCommand,
  sendListSubscriptionsCommand,
  sendSubscribeCommand,
  sendUnsubscribeCommand,
  sendPublishCommand,
};

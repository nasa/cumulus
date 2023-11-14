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

export const sendPublishCommand = async (
  messageParams: PublishCommandInput
) => {
  try {
    await sns().send(new PublishCommand(messageParams));
  } catch (error) {
    throw new Error(`SNS Publish command error: ${error}`);
  }
};

export const sendSubscribeCommand = async (
  messageParams: SubscribeCommandInput
) => {
  try {
    await sns().send(new SubscribeCommand(messageParams));
  } catch (error) {
    throw new Error(`SNS Subscribe command error: ${error}`);
  }
};

export const sendUnsubscribeCommand = async (
  messageParams: UnsubscribeCommandInput
) => {
  try {
    await sns().send(new UnsubscribeCommand(messageParams));
  } catch (error) {
    throw new Error(`SNS Unsubscribe command error: ${error}`);
  }
};

export const sendListSubscriptionsCommand = async (
  messageParams: ListSubscriptionsByTopicCommandInput
) => {
  try {
    await sns().send(new ListSubscriptionsByTopicCommand(messageParams));
  } catch (error) {
    throw new Error(`SNS ListSubscriptionsByTopic command error: ${error}`);
  }
};

export const sendCreateTopicCommand = async (
  messageParams: CreateTopicCommandInput
) => {
  try {
    await sns().send(new CreateTopicCommand(messageParams));
  } catch (error) {
    throw new Error(`SNS CreateTopic command error: ${error}`);
  }
};

export const sendDeleteTopicCommand = async (
  messageParams: DeleteTopicCommandInput
) => {
  try {
    await sns().send(new DeleteTopicCommand(messageParams));
  } catch (error) {
    throw new Error(`SNS DeleteTopic command error: ${error}`);
  }
};

export const sendConfirmSubscriptionCommand = async (
  messageParams: ConfirmSubscriptionCommandInput
) => {
  try {
    await sns().send(new ConfirmSubscriptionCommand(messageParams));
  } catch (error) {
    throw new Error(`SNS ConfirmSubscription command error: ${error}`);
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

/**
 * @module SNS
 */

import pRetry from 'p-retry';
import Logger from '@cumulus/logger';
import { PublishCommand } from '@aws-sdk/client-sns';
import { sns } from './services';
import { CreateTopicCommand, CreateTopicCommandInput, DeleteTopicCommand, DeleteTopicCommandInput, ListSubscriptionsByTopicCommand, ListSubscriptionsByTopicCommandInput, SubscribeCommand, SubscribeCommandInput, UnsubscribeCommand, UnsubscribeCommandInput } from '@aws-sdk/client-sns/dist-types';

const log = new Logger({ sender: 'aws-client/sns' });

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
  message: Object,
  retryOptions = {}
) =>
  await pRetry(
    async () => {
      if (!snsTopicArn) {
        throw new pRetry.AbortError('Missing SNS topic ARN');
      }

      const command = new PublishCommand({
        TopicArn: snsTopicArn,
        Message: JSON.stringify(message),
      });

      await sns().send(command);
    },
    {
      maxTimeout: 5000,
      onFailedAttempt: (err) => log.debug(`publishSnsMessage('${snsTopicArn}', '${JSON.stringify(message)}') failed with ${err.retriesLeft} retries left: ${JSON.stringify(err)}`),
      ...retryOptions,
    }
  );

export const createTopic = async (
  createTopicInput: CreateTopicCommandInput
) => sns().send(new CreateTopicCommand(createTopicInput));

export const deleteTopic = async (
  deleteTopicInput: DeleteTopicCommandInput
) => sns().send(new DeleteTopicCommand(deleteTopicInput));

export const listSubscriptionsByTopic = async (
  listTopicInput: ListSubscriptionsByTopicCommandInput
) => sns().send(new ListSubscriptionsByTopicCommand(listTopicInput));

export const subscribe = async (
  subscribeInput: SubscribeCommandInput
) => sns().send(new SubscribeCommand(subscribeInput));

export const unsubscribe = async (
  unsubscribeInput: UnsubscribeCommandInput
) => sns().send(new UnsubscribeCommand(unsubscribeInput));

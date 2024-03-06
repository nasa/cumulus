/**
 * @module SNS
 */

import pRetry from 'p-retry';
import Logger from '@cumulus/logger';
import {
  CreateTopicCommand,
  CreateTopicCommandInput,
  DeleteTopicCommand,
  DeleteTopicCommandInput,
  ListSubscriptionsByTopicCommand,
  ListSubscriptionsByTopicCommandInput,
  PublishCommand,
  PublishCommandInput,
  SubscribeCommand,
  SubscribeCommandInput,
  UnsubscribeCommand,
  UnsubscribeCommandInput } from '@aws-sdk/client-sns';

import { sns } from './services';

const log = new Logger({ sender: 'aws-client/sns' });

export const publish = async (
  publishInput: PublishCommandInput
) => sns().send(new PublishCommand(publishInput));

// TODO Does this negate benefits AWS is trying to give us with new syntax?
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
export const publishSnsMessageWithRetry = async (
  snsTopicArn: string,
  message: Object,
  retryOptions = {}
) =>
  await pRetry(
    async () => {
      if (!snsTopicArn) {
        throw new pRetry.AbortError('Missing SNS topic ARN');
      }
      publish({
        TopicArn: snsTopicArn,
        Message: JSON.stringify(message),
      });
    },
    {
      maxTimeout: 5000,
      onFailedAttempt: (err) => log.debug(`publishSnsMessageWithRetry('${snsTopicArn}', '${JSON.stringify(message)}') failed with ${err.retriesLeft} retries left: ${JSON.stringify(err)}`),
      ...retryOptions,
    }
  );

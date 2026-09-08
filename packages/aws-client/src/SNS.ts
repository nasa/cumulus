/**
 * @module SNS
 */

import pRetry from 'p-retry';
import Logger from '@cumulus/logger';
import { errorify } from '@cumulus/errors';
import {
  PublishCommand,
  CreateTopicCommand,
  DeleteTopicCommand,
  DeleteTopicCommandOutput,
  SubscribeCommand,
  SubscribeCommandOutput,
} from '@aws-sdk/client-sns';

import { sns } from './services';

const log = new Logger({ sender: 'aws-client/sns' });

/**
 * Publish a message to an SNS topic. Does not catch
 * errors, to allow more specific handling by the caller.
 *
 * @param snsTopicArn - SNS topic ARN
 * @param message - Message object
 * @param retryOptions - options to control retry behavior when publishing
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
      const publishInput = {
        TopicArn: snsTopicArn,
        Message: JSON.stringify(message),
      };
      await sns().send(new PublishCommand(publishInput));
    },
    {
      maxTimeout: 5000,
      onFailedAttempt: (err) => log.debug(`publishSnsMessageWithRetry('${snsTopicArn}', '${JSON.stringify(message)}') failed with ${err.retriesLeft} retries left: ${errorify(err)}`),
      ...retryOptions,
    }
  );

/**
 * Create an SNS topic with a given name.
 *
 * @param snsTopicName - Name of the SNS topic
 * @returns - ARN of the created SNS topic
 */
export const createSnsTopic = async (
  snsTopicName: string
): Promise<{ TopicArn: string | undefined }> => {
  const createTopicInput = {
    Name: snsTopicName,
    KmsMasterKeyId: 'alias/aws/sns',
  };
  const createTopicCommand = new CreateTopicCommand(createTopicInput);
  const createTopicResponse = await sns().send(createTopicCommand);
  return { TopicArn: createTopicResponse.TopicArn };
};

/**
 * Delete an SNS topic with a given ARN.
 *
 * @param snsTopicArn - ARN of the SNS topic
 * @returns - Promise that resolves when the topic is deleted
 */
export const deleteSnsTopic = async (snsTopicArn: string): Promise<DeleteTopicCommandOutput> => {
  const deleteTopicCommand = new DeleteTopicCommand({ TopicArn: snsTopicArn });
  return await sns().send(deleteTopicCommand);
};

/**
 * Subscribe an SQS queue to an SNS topic.
 *
 * @param snsTopicArn - ARN of the SNS topic
 * @param sqsQueueArn - ARN of the SQS queue
 * @returns - Promise that resolves with the subscription ARN
 */
export const subscribeSqsToSnsTopic = async (
  snsTopicArn: string,
  sqsQueueArn: string
): Promise<SubscribeCommandOutput> => {
  const subscribeCommand = new SubscribeCommand({
    TopicArn: snsTopicArn,
    Protocol: 'sqs',
    Endpoint: sqsQueueArn,
  });
  return await sns().send(subscribeCommand);
};

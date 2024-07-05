/**
 * @module SNS
 */

import pRetry from 'p-retry';
import Logger from '@cumulus/logger';

import { sns } from './services';

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
  message: any,
  retryOptions = {}
) =>
  await pRetry(
    async () => {
      if (!snsTopicArn) {
        throw new pRetry.AbortError('Missing SNS topic ARN');
      }

      await sns().publish({
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
  const createTopicResponse = await sns().createTopic(createTopicInput);
  return { TopicArn: createTopicResponse.TopicArn };
};

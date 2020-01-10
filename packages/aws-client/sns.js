const pRetry = require('p-retry');
const Logger = require('@cumulus/logger');
const awsServices = require('./services');

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
exports.publishSnsMessage = async (
  snsTopicArn,
  message,
  retryOptions = {}
) =>
  pRetry(
    async () => {
      if (!snsTopicArn) {
        throw new pRetry.AbortError('Missing SNS topic ARN');
      }

      await awsServices.sns().publish({
        TopicArn: snsTopicArn,
        Message: JSON.stringify(message)
      }).promise();
    },
    {
      maxTimeout: 5000,
      onFailedAttempt: (err) => log.debug(`publishSnsMessage('${snsTopicArn}', '${message}') failed with ${err.retriesLeft} retries left: ${err.message}`),
      ...retryOptions
    }
  );

'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');

const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const publishCollectionSnsMessage = async (record, event) => {
  let messageToPublish;
  if (event === 'Delete') {
    messageToPublish = { event, record, deletedAt: Date.now() };
  } else {
    messageToPublish = { event, record };
  }
  const topicArn = envUtils.getRequiredEnvVar('collection_sns_topic_arn', process.env);
  logger.info(`About to publish SNS message ${JSON.stringify(record)} for collection to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, messageToPublish);
};

module.exports = {
  publishCollectionSnsMessage,
};
'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const publishPdrSnsMessage = async (record) => {
  const topicArn = envUtils.getRequiredEnvVar('pdr_sns_topic_arn', process.env);
  logger.info(`About to publish SNS message ${JSON.stringify(record)} for pdr to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, record);
};

const constructSnsMessage = (record, event) => {
  switch (event) {
  case 'Create':
  case 'Update':
    return { event, record };
  case 'Delete': return {
    event,
    record: {
      name: record.name,
      version: record.version,
    },
    deletedAt: Date.now(),
  };
  default: return {};
  }
};

const publishCollectionSnsMessage = async (record, event) => {
  const topicArn = envUtils.getRequiredEnvVar('collection_sns_topic_arn', process.env);
  const messageToPublish = constructSnsMessage(record, event);

  logger.info(`About to publish SNS message ${JSON.stringify(messageToPublish)} for collection to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, messageToPublish);
};

module.exports = {
  publishCollectionSnsMessage,
  publishPdrSnsMessage,
};

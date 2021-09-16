'use strict';

const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const { envUtils } = require('@cumulus/common');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/publishSnsMessageUtils' });

const publishExecutionSnsMessage = async (record) => {
  const topicArn = envUtils.getRequiredEnvVar('execution_sns_topic_arn', process.env);
  logger.info(`About to publish SNS message ${JSON.stringify(record)} for execution to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, record);
};

const constructCollectionSnsMessage = (record, event) => {
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

const constructGranuleSnsMessage = (record, event) => {
  switch (event) {
  case 'Create':
  case 'Update':
    return { event, record };
  case 'Delete': return {
    event,
    record,
    deletedAt: Date.now(),
  };
  default: return {};
  }
};

const publishGranuleSnsMessage = async (record, event) => {
  const topicArn = envUtils.getRequiredEnvVar('granule_sns_topic_arn', process.env);
  const messageToPublish = constructGranuleSnsMessage(record, event);

  logger.info(`About to publish SNS message ${JSON.stringify(record)} for granule to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, messageToPublish);
};

const publishCollectionSnsMessage = async (record, event) => {
  const topicArn = envUtils.getRequiredEnvVar('collection_sns_topic_arn', process.env);
  const messageToPublish = constructCollectionSnsMessage(record, event);

  logger.info(`About to publish SNS message ${JSON.stringify(messageToPublish)} for collection to topic ARN ${topicArn}`);
  await publishSnsMessage(topicArn, messageToPublish);
};

module.exports = {
  publishGranuleSnsMessage,
  publishCollectionSnsMessage,
  publishExecutionSnsMessage,
};
